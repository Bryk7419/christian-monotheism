import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import make_audio as audio


class AudioBatchTests(unittest.TestCase):
    def test_batch_is_explicit_and_deduplicated(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'batch.json'
            path.write_text('["first", "second", "first"]')
            self.assertEqual(audio.read_batch(path), ['first', 'second'])

    def test_invalid_batch_never_means_all_articles(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'batch.json'
            for value in [[], {}, None, 'first', [''], ['*'], ['../first'], [42]]:
                with self.subTest(value=value):
                    path.write_text(json.dumps(value))
                    with self.assertRaises(ValueError):
                        audio.read_batch(path)

    def test_empty_batch_exits_before_selecting_voice(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'batch.json'
            path.write_text('[]')
            with patch('sys.argv', ['make_audio.py', '--batch-file', str(path)]), \
                    patch.object(audio, 'provider') as provider, \
                    contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    audio.main()
                self.assertEqual(error.exception.code, 2)
                provider.assert_not_called()

    def test_selected_run_preserves_unrelated_recordings(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            out = root / 'assets' / 'audio'
            out.mkdir(parents=True)
            index_path = out / 'index.json'
            untouched = {'other': {'h': 'keep'}, 'removed-article': {'h': 'keep-too'}}
            index_path.write_text(json.dumps(untouched))
            (out / 'removed-article.mp3').write_bytes(b'preserve')
            for slug in ['selected', 'other']:
                page = root / 'answers' / slug / 'index.html'
                page.parent.mkdir(parents=True)
                page.write_text('test fixture')
            batch = root / 'batch.json'
            batch.write_text('["selected"]')
            voice = Mock(id='test-voice', rate=24000)
            with patch('sys.argv', ['make_audio.py', '--batch-file', str(batch)]), \
                    patch.multiple(audio, ROOT=root, OUT=out, INDEX=index_path), \
                    patch.object(audio, 'provider', return_value=voice), \
                    patch.object(audio, 'read_article', return_value={'title': 'Title', 'blocks': []}), \
                    patch.object(audio, 'speakable', return_value={'selected': [['A']], 'other': [['B']]}), \
                    patch.object(audio, 'build', return_value=(b'\0\0' * 24000, [])) as build, \
                    patch.object(audio, 'encode') as encode, \
                    contextlib.redirect_stdout(io.StringIO()):
                audio.main()
            build.assert_called_once()
            self.assertEqual(encode.call_args.args[2], out / 'selected.mp3')
            after = json.loads(index_path.read_text())
            for slug, record in untouched.items():
                self.assertEqual(after[slug], record)
            self.assertEqual((out / 'removed-article.mp3').read_bytes(), b'preserve')
            self.assertIn('selected', after)


if __name__ == '__main__':
    unittest.main()
