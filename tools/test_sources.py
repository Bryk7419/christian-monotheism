"""Regression checks for bibliography loss during article rebuilding."""
import unittest

from sitegen import EXT, parse_source_list


class SourceListTests(unittest.TestCase):
    def test_canonical_entry_is_unchanged(self):
        item = ('<li><a class="ext" href="https://example.org/" target="_blank" '
                f'rel="noopener">Commentary{EXT}</a></li>')
        self.assertEqual(parse_source_list('\n  ' + item + '\n'), [item])

    def test_annotations_multiple_links_and_plain_entries_survive(self):
        items = [
            '<li>Newman and Nida. <a href="https://example.org/commentary">'
            '<em>Translator’s Handbook</em></a>. UBS, 1980.</li>',
            '<li><a href="https://example.org/2">John 2</a>;\n'
            '<a href="https://example.org/10">John 10</a>.</li>',
            '<li>A printed source without an online edition.</li>',
        ]
        self.assertEqual(parse_source_list('\n'.join(items)), items)

    def test_empty_list(self):
        self.assertEqual(parse_source_list('\n  '), [])

    def test_unrecognized_content_fails_instead_of_disappearing(self):
        for malformed in ['<p>Source</p>', '<li>Unclosed entry',
                          '<li>Outer<ul><li>Nested</li></ul></li>']:
            with self.subTest(malformed=malformed), self.assertRaises(ValueError):
                parse_source_list(malformed)


if __name__ == '__main__':
    unittest.main()
