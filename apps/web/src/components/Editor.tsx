import React, { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';

interface EditorProps {
  content: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCommandPalette: () => void;
}

export const Editor: React.FC<EditorProps> = ({
  content,
  onChange,
  onSave,
  onCommandPalette,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const isInternalUpdate = useRef(false);

  // Initialize CodeMirror instance
  useEffect(() => {
    if (!containerRef.current) return;

    const customKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          onSave();
          return true;
        },
      },
      {
        key: 'Mod-p',
        run: () => {
          onCommandPalette();
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !isInternalUpdate.current) {
        onChange(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        markdown({ base: markdownLanguage }),
        oneDark,
        customKeymap,
        updateListener,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    editorViewRef.current = view;

    return () => {
      view.destroy();
    };
  }, []);

  // Update doc when active file changes externally
  useEffect(() => {
    const view = editorViewRef.current;
    if (view) {
      const currentDoc = view.state.doc.toString();
      if (currentDoc !== content) {
        isInternalUpdate.current = true;
        view.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: content },
        });
        isInternalUpdate.current = false;
      }
    }
  }, [content]);

  return <div ref={containerRef} className="codemirror-wrapper" />;
};
