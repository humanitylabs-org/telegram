# python3 -m unittest tests/test_catchup.py
import importlib.util
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent


def load(data_dir):
    os.environ['DATA_DIR'] = data_dir
    os.environ['WIZARD_SWITCHES_DIR'] = data_dir
    spec = importlib.util.spec_from_file_location('tg_server', HERE / 'app' / 'server.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def call(srv, name, args):
    out = srv.rpc({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': name, 'arguments': args}})
    return out['result']


class CatchupTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.srv = load(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_switch_listed_off_with_issue(self):
        sw = {s['id']: s for s in self.srv.switches_doc()['switches']}
        self.assertFalse(sw['catch-me-up']['on'])
        self.assertEqual(sw['catch-me-up']['issues'], ['humanitylabs-org/telegram#7', 'humanitylabs-org/wizard-os#758'])

    def test_newest_preview_is_always_on_and_its_switch_cleared(self):
        # telegram#1 approved: no switch any more, and an old stored value is dropped.
        self.assertNotIn('newest-preview', {s['id'] for s in self.srv.switches_doc()['switches']})
        f = Path(self.tmp.name) / 'switches.json'
        f.write_text(json.dumps({'newest-preview': False, 'catch-me-up': True}))
        self.srv.clear_retired_switches()
        self.assertEqual(json.loads(f.read_text()), {'catch-me-up': True})

    def test_numbered_models_is_always_on_and_its_switch_cleared(self):
        # telegram#13 approved: no switch any more, and an old stored value is dropped.
        self.assertNotIn('numbered-models', {s['id'] for s in self.srv.switches_doc()['switches']})
        f = Path(self.tmp.name) / 'switches.json'
        f.write_text(json.dumps({'numbered-models': True, 'catch-me-up': True}))
        self.srv.clear_retired_switches()
        self.assertEqual(json.loads(f.read_text()), {'catch-me-up': True})

    def test_tools_listed(self):
        names = {t['name'] for t in self.srv.TOOLS}
        self.assertIn('catchup_list', names)
        self.assertNotIn('catchup_record', names)   # fresh pull every time: nothing records for the next one

    def test_notifications_are_only_the_chats_routed_ones(self):
        # wizard-os#758 follow-up: never the raw Notifications inbox or its unread count.
        tool = next(t for t in self.srv.TOOLS if t['name'] == 'catchup_list')
        self.assertIn('routing sends to Chats', tool['description'])
        self.assertIn("never read the Notifications app's inbox", tool['description'])
        self.srv.save_catchup({'notifications': [{'id': 1}]})
        doc = call(self.srv, 'catchup_list', {})['structuredContent']
        self.assertIn('routing sends to Chats', doc['notifications_scope'])
        self.assertIn('never read the Notifications app inbox', doc['notifications_scope'])

    def test_skill_has_the_followups(self):
        skill = (Path(__file__).resolve().parent.parent / 'skill' / 'SKILL.md').read_text()
        self.assertIn('never report its unread count', skill)
        self.assertIn('`to watch` line', skill)
        self.assertIn('keep them unread', skill)
        self.assertIn('two short sentences of real context', skill)
        self.assertNotIn('one sentence of real context', skill)

    def test_each_catchup_is_a_fresh_pull(self):
        a = self.srv.save_catchup({'chats': [{'id': 'c1', 'title': 'One'}], 'notifications': [{'id': 7, 'title': 'Bill'}]})
        self.assertNotIn('previous', a)
        first = call(self.srv, 'catchup_list', {})['structuredContent']
        self.assertEqual([c['id'] for c in first['chats']], ['c1'])
        self.assertEqual([n['id'] for n in first['notifications']], ['7'])
        import time; time.sleep(1.1)   # ids sort by the second they were made
        b = self.srv.save_catchup({'chats': [{'id': 'c1'}, {'id': 'c2'}], 'notifications': [{'id': '8'}]})
        self.assertEqual(set(b), {'catchup_id', 'chats', 'notifications'})
        doc = call(self.srv, 'catchup_list', {})['structuredContent']
        self.assertEqual(doc['catchup_id'], b['catchup_id'])
        self.assertEqual(set(doc), {'catchup_id', 'created', 'chats', 'notifications', 'notifications_scope'})
        self.assertEqual([c['id'] for c in doc['chats']], ['c1', 'c2'])
        self.assertEqual([n['id'] for n in doc['notifications']], ['8'])
        old = call(self.srv, 'catchup_list', {'catchup_id': a['catchup_id']})['structuredContent']
        self.assertEqual([c['id'] for c in old['chats']], ['c1'])

    def test_empty_ready_is_fine_and_bad_input_refused(self):
        self.assertEqual(self.srv.save_catchup({})['chats'], 0)
        with self.assertRaises(self.srv.Problem):
            self.srv.save_catchup({'chats': [{'title': 'no id'}]})
        bad = call(self.srv, 'catchup_list', {'catchup_id': '../etc/passwd'})
        self.assertTrue(bad['isError'])
        gone = self.srv.rpc({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
                             'params': {'name': 'catchup_record', 'arguments': {'catchup_id': 'cu_20260101_000000_abcdef'}}})
        self.assertTrue('error' in gone or gone.get('result', {}).get('isError'))   # the tool is gone

    def test_http_route_follows_switch(self):
        httpd = ThreadingHTTPServer(('127.0.0.1', 0), self.srv.Handler)
        port = httpd.server_address[1]
        self.srv.TRUSTED_HOSTS.add(f'127.0.0.1:{port}')
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            def post():
                req = urllib.request.Request(f'http://127.0.0.1:{port}/api/catchup', data=json.dumps({'chats': []}).encode(),
                                             headers={'Content-Type': 'application/json'}, method='POST')
                try:
                    with urllib.request.urlopen(req) as r:
                        return r.status, json.loads(r.read())
                except urllib.error.HTTPError as e:
                    return e.code, json.loads(e.read())
            self.assertEqual(post()[0], 404)
            (Path(self.tmp.name) / 'switches.json').write_text(json.dumps({'catch-me-up': True}))
            code, body = post()
            self.assertEqual(code, 201)
            self.assertTrue(body['catchup_id'].startswith('cu_'))
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/features') as r:
                self.assertTrue(json.loads(r.read())['catch-me-up'])
        finally:
            httpd.shutdown()


if __name__ == '__main__':
    unittest.main()
