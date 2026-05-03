<script setup>
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { watch, onBeforeUnmount } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])

const editor = useEditor({
  content: props.modelValue,
  extensions: [StarterKit],
  onUpdate({ editor }) {
    emit('update:modelValue', editor.getHTML())
  }
})

watch(() => props.modelValue, (val) => {
  if (editor.value && editor.value.getHTML() !== val) {
    editor.value.commands.setContent(val || '', false)
  }
})

onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

<template>
  <div class="storefront-editor">
    <div v-if="editor" class="toolbar">
      <div class="toolbar-group">
        <button
          type="button"
          @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
          :class="{ active: editor.isActive('heading', { level: 1 }) }"
          title="Heading 1"
        >H1</button>
        <button
          type="button"
          @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
          :class="{ active: editor.isActive('heading', { level: 2 }) }"
          title="Heading 2"
        >H2</button>
        <button
          type="button"
          @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
          :class="{ active: editor.isActive('heading', { level: 3 }) }"
          title="Heading 3"
        >H3</button>
        <button
          type="button"
          @click="editor.chain().focus().setParagraph().run()"
          :class="{ active: editor.isActive('paragraph') }"
          title="Normal text"
        >P</button>
      </div>

      <span class="toolbar-divider"></span>

      <div class="toolbar-group">
        <button
          type="button"
          @click="editor.chain().focus().toggleBold().run()"
          :class="{ active: editor.isActive('bold') }"
          title="Bold"
        ><strong>B</strong></button>
        <button
          type="button"
          @click="editor.chain().focus().toggleItalic().run()"
          :class="{ active: editor.isActive('italic') }"
          title="Italic"
        ><em>I</em></button>
        <button
          type="button"
          @click="editor.chain().focus().toggleStrike().run()"
          :class="{ active: editor.isActive('strike') }"
          title="Strikethrough"
          class="strike-label"
        >S</button>
      </div>

      <span class="toolbar-divider"></span>

      <div class="toolbar-group">
        <button
          type="button"
          @click="editor.chain().focus().toggleBulletList().run()"
          :class="{ active: editor.isActive('bulletList') }"
          title="Bullet list"
        >&#8226; List</button>
        <button
          type="button"
          @click="editor.chain().focus().toggleOrderedList().run()"
          :class="{ active: editor.isActive('orderedList') }"
          title="Numbered list"
        >1. List</button>
      </div>

      <span class="toolbar-divider"></span>

      <div class="toolbar-group">
        <button
          type="button"
          @click="editor.chain().focus().toggleBlockquote().run()"
          :class="{ active: editor.isActive('blockquote') }"
          title="Blockquote"
        >" Quote</button>
        <button
          type="button"
          @click="editor.chain().focus().setHorizontalRule().run()"
          title="Horizontal line"
        >&#8213;</button>
      </div>

      <span class="toolbar-divider"></span>

      <div class="toolbar-group">
        <button
          type="button"
          @click="editor.chain().focus().undo().run()"
          :disabled="!editor.can().undo()"
          title="Undo"
        >&#8617;</button>
        <button
          type="button"
          @click="editor.chain().focus().redo().run()"
          :disabled="!editor.can().redo()"
          title="Redo"
        >&#8618;</button>
      </div>
    </div>

    <EditorContent :editor="editor" class="editor-content" />
  </div>
</template>

<style scoped>
.storefront-editor {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--color-background, #fff);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 8px 10px;
  background: var(--color-background-soft, #f8f8f8);
  border-bottom: 1px solid var(--color-border);
  flex-wrap: wrap;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 1px;
}

.toolbar button {
  padding: 4px 9px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 500;
  line-height: 1.4;
  transition: background 0.12s, border-color 0.12s;
  white-space: nowrap;
}

.toolbar button:hover:not(:disabled) {
  background: var(--color-border);
}

.toolbar button.active {
  background: var(--color-link);
  color: #fff;
  border-color: var(--color-link);
}

.toolbar button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.strike-label {
  text-decoration: line-through;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--color-border);
  margin: 0 5px;
  flex-shrink: 0;
}

.editor-content {
  min-height: 400px;
}

.editor-content :deep(.tiptap) {
  padding: 16px 18px;
  min-height: 400px;
  outline: none;
  color: var(--color-text);
  font-size: 1rem;
  line-height: 1.7;
}

.editor-content :deep(.tiptap p) {
  margin: 0 0 0.85em;
}

.editor-content :deep(.tiptap p:last-child) {
  margin-bottom: 0;
}

.editor-content :deep(.tiptap h1) {
  font-size: 2rem;
  font-weight: 700;
  margin: 0.5em 0 0.4em;
  line-height: 1.2;
  color: var(--color-text);
}

.editor-content :deep(.tiptap h2) {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0.7em 0 0.4em;
  line-height: 1.3;
  color: var(--color-text);
}

.editor-content :deep(.tiptap h3) {
  font-size: 1.15rem;
  font-weight: 600;
  margin: 0.8em 0 0.35em;
  color: var(--color-text);
}

.editor-content :deep(.tiptap ul),
.editor-content :deep(.tiptap ol) {
  padding-left: 1.6em;
  margin: 0.5em 0;
}

.editor-content :deep(.tiptap li) {
  margin-bottom: 0.2em;
}

.editor-content :deep(.tiptap blockquote) {
  border-left: 3px solid var(--color-link);
  margin: 0.8em 0;
  padding: 0.4em 0 0.4em 1em;
  color: var(--color-text-secondary);
  font-style: italic;
}

.editor-content :deep(.tiptap hr) {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 1.2em 0;
}

.editor-content :deep(.tiptap strong) {
  font-weight: 700;
}

.editor-content :deep(.tiptap em) {
  font-style: italic;
}

.editor-content :deep(.tiptap s) {
  text-decoration: line-through;
}
</style>
