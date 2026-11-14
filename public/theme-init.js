(() => {
  let theme = 'system'
  try { theme = localStorage.getItem('pinease-theme') || 'system' } catch {}
  const dark = theme === 'dark' || (theme !== 'light' && theme !== 'dark' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#171e19' : '#f8f7f2')
})()
