<script setup lang="ts">
withDefaults(defineProps<{ bad?: boolean; compact?: boolean }>(), { bad: false, compact: false })
</script>

<template>
  <svg viewBox="0 0 520 360" fill="none" class="posture-illustration" role="img" :aria-label="bad ? '低头坐姿示意' : '舒适坐姿示意'">
    <rect x="32" y="30" width="456" height="296" rx="12" fill="var(--illustration-paper, #eeeae0)" />
    <path d="M65 274H456M342 140V225M338 225H444M393 225V286" stroke="var(--illustration-line, #b7b9ad)" stroke-width="3" stroke-linecap="round"/>
    <rect x="332" y="87" width="92" height="67" rx="6" fill="var(--illustration-screen, #e4e4da)" stroke="var(--illustration-line, #899688)" stroke-width="3"/>
    <path d="M378 154V174M360 174H396M320 178H414" stroke="var(--illustration-line, #899688)" stroke-width="3" stroke-linecap="round"/>
    <path d="M171 160V227Q171 248 195 248H260M185 249V287M255 249V287" stroke="var(--illustration-line, #899688)" stroke-width="5" stroke-linecap="round"/>
    <path d="M157 105V215" stroke="var(--illustration-line, #a6afa0)" stroke-width="8" stroke-linecap="round"/>
    <g :transform="bad ? 'translate(15 10)' : ''" class="illustration-person">
      <path :d="bad ? 'M224 127Q231 163 248 208' : 'M228 127Q216 167 227 208'" stroke="#466747" stroke-width="35" stroke-linecap="round"/>
      <path d="M239 209L284 215L303 268" stroke="#626857" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M302 270L330 275" stroke="#394c3b" stroke-width="14" stroke-linecap="round"/>
      <path :d="bad ? 'M231 147L264 175L310 177' : 'M228 147L253 175L310 177'" stroke="#859776" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
      <path :d="bad ? 'M237 124L254 102' : 'M228 122L227 100'" stroke="#d8ba9b" stroke-width="13" stroke-linecap="round"/>
      <circle :cx="bad ? 260 : 227" :cy="bad ? 87 : 79" r="26" fill="#dbc0a2"/>
      <path :d="bad ? 'M235 83Q237 52 266 62Q284 69 283 84Q268 72 259 77Q255 86 235 83Z' : 'M202 77Q199 47 229 49Q252 53 253 78Q241 66 228 67Q216 81 202 77Z'" fill="#5c6250"/>
    </g>
    <path d="M109 104V229" stroke="#bec9ae" stroke-width="2" stroke-dasharray="4 6"/>
    <circle cx="109" cy="104" r="5" fill="#708568"/><circle cx="109" cy="229" r="5" fill="#708568"/>
    <path d="M65 293H456" stroke="var(--illustration-floor, #d5d6ca)" stroke-width="2"/>
    <path d="M444 274V219M431 246Q444 228 457 246M431 232Q444 214 457 232" stroke="#8b9a7d" stroke-width="3" stroke-linecap="round"/>
  </svg>
</template>

