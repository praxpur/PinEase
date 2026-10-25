<script setup lang="ts">
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose } from 'reka-ui'
import { X } from 'lucide-vue-next'
defineProps<{ open: boolean; title: string; description?: string; wide?: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog-content" :class="{ 'dialog-wide': wide }">
        <div class="dialog-heading">
          <DialogTitle class="dialog-title">{{ title }}</DialogTitle>
          <DialogClose class="icon-button" aria-label="关闭"><X :size="19" /></DialogClose>
        </div>
        <DialogDescription class="dialog-description">{{ description || ' ' }}</DialogDescription>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

