function isTrustedUrl(value, developmentUrl) {
  try {
    const url = new URL(value)
    if (url.username || url.password) return false
    if (url.protocol === 'app:' && url.hostname === 'pinease' && !url.port) return true
    if (!developmentUrl) return false
    const dev = new URL(developmentUrl)
    return dev.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(dev.hostname)
      && url.origin === dev.origin
  } catch { return false }
}
function canRequest(permission, details = {}) {
  if (details.isMainFrame === false) return false
  if (permission === 'notifications') return true
  return permission === 'media' && Array.isArray(details.mediaTypes)
    && details.mediaTypes.includes('video') && !details.mediaTypes.includes('audio')
}
function canCheck(permission, details = {}) {
  if (details.isMainFrame === false) return false
  return permission === 'notifications' || permission === 'media' && details.mediaType === 'video'
}
module.exports = { isTrustedUrl, canRequest, canCheck }
