// oci-common の require("isomorphic-fetch") は fetch polyfill の副作用import。
// browser版実体は self.fetch を即時参照するため、self を持たない実行環境(素のNode)で落ちる。
// 実行環境(Node >= 18 / Electron)は fetch/Request/Headers を標準搭載しており polyfill 自体が不要。
module.exports = {};
