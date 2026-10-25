<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui'
defineProps<{ modelValue: boolean; label: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <SwitchRoot class="app-switch" :model-value="modelValue" :aria-label="label" :disabled="disabled" @update:model-value="emit('update:modelValue', $event)">
    <SwitchThumb class="switch-thumb" />
  </SwitchRoot>
</template>

