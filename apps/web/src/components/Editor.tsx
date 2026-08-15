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

  // Keep latest callbacks in refs to eliminate any possible stale closure
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCommandPaletteRef = useRef(onCommandPalette);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
    onCommandPaletteRef.current = onCommandPalette;
  });

  // Initialize CodeMirror instance for this note
  useEffect(() => {
    if (!containerRef.current) return;

    const customKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          onSaveRef.current();
          return true; // Prevents further default action
        },
      },
      {
        key: 'Mod-p',
        run: () => {
          onCommandPaletteRef.current();
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !isInternalUpdate.current) {
        onChangeRef.current(update.state.doc.toString());
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
  }, []); // Mounted per note via key={activeTab.path}

  // Handle external content updates
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
