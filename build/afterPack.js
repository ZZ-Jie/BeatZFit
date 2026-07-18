// afterPack hook: 删除打包产物中不需要的 Electron 运行时文件以减小安装包体积
const fs = require('fs')
const path = require('path')

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir

  // 1. 删除 LICENSES.chromium.html (~8.75MB，Chromium 许可文件，用户无需查看)
  const licensesFile = path.join(appOutDir, 'LICENSES.chromium.html')
  if (fs.existsSync(licensesFile)) {
    fs.unlinkSync(licensesFile)
    console.log('  • afterPack: removed LICENSES.chromium.html')
  }
}
