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

// Keep editor in sync if parent changes the value externally
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
  <div class="rich-editor">
    <div v-if="editor" class="toolbar">
      <button type="button" @click="editor.chain().focus().toggleBold().run()" :class="{ active: editor.isActive('bold') }" title="Bold">B</button>
      <button type="button" @click="editor.chain().focus().toggleItalic().run()" :class="{ active: editor.isActive('italic') }" title="Italic">I</button>
      <button type="button" @click="editor.chain().focus().toggleStrike().run()" :class="{ active: editor.isActive('strike') }" title="Strikethrough">S</button>
      <span class="toolbar-divider"></span>
      <button type="button" @click="editor.chain().focus().toggleBulletList().run()" :class="{ active: editor.isActive('bulletList') }" title="Bullet list">&#8226; List</button>
      <button type="button" @click="editor.chain().focus().toggleOrderedList().run()" :class="{ active: editor.isActive('orderedList') }" title="Numbered list">1. List</button>
      <span class="toolbar-divider"></span>
      <button type="button" @click="editor.chain().focus().setParagraph().run()" :class="{ active: editor.isActive('paragraph') }" title="Paragraph">P</button>
      <button type="button" @click="editor.chain().focus().toggleHeading({ level: 3 }).run()" :class="{ active: editor.isActive('heading', { level: 3 }) }" title="Heading">H</button>
      <span class="toolbar-divider"></span>
      <button type="button" @click="editor.chain().focus().undo().run()" :disabled="!editor.can().undo()" title="Undo">&#8617;</button>
      <button type="button" @click="editor.chain().focus().redo().run()" :disabled="!editor.can().redo()" title="Redo">&#8618;</button>
    </div>
    <EditorContent :editor="editor" class="editor-content" />
  </div>
</template>

<style scoped>
.rich-editor {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--color-background-input);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px;
  background: var(--color-background-hover, #f5f5f5);
  border-bottom: 1px solid var(--color-border);
  flex-wrap: wrap;
}

.toolbar button {
  padding: 3px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  line-height: 1.4;
  transition: background 0.15s;
}

.toolbar button:hover:not(:disabled) {
  background: var(--color-border);
}

.toolbar button.active {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
}

.toolbar button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: var(--color-border);
  margin: 0 4px;
}

.editor-content {
  min-height: 150px;
}

.editor-content :deep(.tiptap) {
  padding: 10px 12px;
  min-height: 150px;
  outline: none;
  color: var(--color-text);
  font-size: 1rem;
  line-height: 1.6;
  resize: vertical;
  overflow-y: auto;
}

.editor-content :deep(.tiptap p) {
  margin: 0 0 0.75em;
}

.editor-content :deep(.tiptap p:last-child) {
  margin-bottom: 0;
}

.editor-content :deep(.tiptap ul),
.editor-content :deep(.tiptap ol) {
  padding-left: 1.5em;
  margin: 0.5em 0;
}

.editor-content :deep(.tiptap h3) {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0.75em 0 0.4em;
}

.editor-content :deep(.tiptap strong) {
  font-weight: 700;
}

.editor-content :deep(.tiptap em) {
  font-style: italic;
}

/* Size variants */
.rich-editor.lg .editor-content :deep(.tiptap) {
  min-height: 200px;
}

.rich-editor.sm .editor-content :deep(.tiptap) {
  min-height: 100px;
}
</style>
