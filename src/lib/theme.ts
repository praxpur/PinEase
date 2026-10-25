import { readonly, ref } from 'vue'

export type ThemePreference = 'system' | 'light' | 'dark'
const key = 'pinease-theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')
function savedPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(key)
    if (value === 'light' || value === 'dark') return value
  } catch { /* Theme selection still works when storage is unavailable. */ }
  return 'system'
}
const preference = ref<ThemePreference>(savedPreference())
const dark = ref(false)
function apply() {
  dark.value = preference.value === 'dark' || (preference.value === 'system' && media.matches)
  document.documentElement.dataset.theme = dark.value ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark.value ? '#171e19' : '#f8f7f2')
}
export function setTheme(value: ThemePreference) {
  preference.value = value
  try {
    if (value === 'system') localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* Keep the selection for this page session. */ }
  apply()
}
media.addEventListener('change', apply)
window.addEventListener('storage', (event) => {
  if (event.key === key || event.key === null) { preference.value = savedPreference(); apply() }
})
apply()
export const themePreference = readonly(preference)
export const isDarkTheme = readonly(dark)
