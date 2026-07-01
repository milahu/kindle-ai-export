// deduplicate images between HAR images and screenshot images
// HAR images have paths matching `out/${asin}/${sha1}.png`
//
// the HAR images are 4x larger:
//
// $ identify out/B0DTZ195XS/7c82edfa049c47b0d5f9c8e4cc43d369f7739514.png
// out/B0DTZ195XS/7c82edfa049c47b0d5f9c8e4cc43d369f7739514.png PNG 2047x1141 2047x1141+0+0 8-bit sRGB 154027B 0.000u 0:00.000
//
// $ identify out/B0DTZ195XS/pages/white/0001-00100-b0003925-3569-46ae-a988-52e7935df33c.png
// out/B0DTZ195XS/pages/white/0001-00100-b0003925-3569-46ae-a988-52e7935df33c.png PNG 1024x571 
//
// 2048 / 1024 = 2

import 'dotenv/config'

import fs from 'node:fs/promises'

import child_process from 'node:child_process'

import looksSame from 'looks-same'

import { PNG } from 'pngjs'

import {


  getEnv,


} from './utils.js'

const asin = getEnv('ASIN')

// https://stackoverflow.com/questions/11247790/reading-a-png-image-in-node-js
// https://github.com/pngjs/pngjs#example
function imageInvertColors(image) {
  if (!image || !image.data) return;
  for (var y = 0; y < image.height; y++) {
    for (var x = 0; x < image.width; x++) {
      var idx = (image.width * y + x) << 2;
      // invert color
      image.data[idx] = 255 - image.data[idx]; // R
      image.data[idx+1] = 255 - image.data[idx+1]; // G
      image.data[idx+2] = 255 - image.data[idx+2]; // B
      // and reduce opacity
      // image.data[idx+3] = image.data[idx+3] >> 1;
    }
  }
}

async function main() {
  const whiteDir = `out/${asin}/pages/white`
  const blackDir = `out/${asin}/pages/black`

  let whiteFiles = await fs.readdir(whiteDir)
  let blackFiles = await fs.readdir(blackDir)

  whiteFiles.sort()
  blackFiles.sort()

  whiteFiles = whiteFiles.filter(path => (
    !path.endsWith('.inv.png') && // inverted
    !path.endsWith('.mon.png') // montage
  ))

  const matches = []

  console.dir({ PNG })

  for (let whiteIdx = 0; whiteIdx < whiteFiles.length; whiteIdx++) {
    const whitePath = `${whiteDir}/${whiteFiles[whiteIdx]}`
    const whiteImageInverted = PNG.sync.read(await fs.readFile(whitePath));
    // const whiteImageInverted = PNG.sync.read(fs.readFileSync(whitePath));
    // invert colors from white to black background
    imageInvertColors(whiteImageInverted)
    // whiteImageInverted.pack().pipe(fs.createWriteStream('out.png'))
    const whiteInvertedBytes = PNG.sync.write(whiteImageInverted)
    // debug: write whiteInverted
    await fs.writeFile(`${whitePath}.inv.png`, whiteInvertedBytes)

    // TODO loop black files with increasing distance
    // TODO skip "consumed" black files (blackPath == null)
    const blackIdx = whiteIdx
    const blackPath = `${blackDir}/${blackFiles[blackIdx]}`

    // const {equal} = await looksSame(whiteInvertedBytes, blackPath, { tolerance: 5 })
    const {equal} = await looksSame(whiteInvertedBytes, blackPath, { tolerance: 80 })

    if (equal) {
      console.log(`found match: ${whitePath} ${blackPath}`)
      matches.push([whitePath, blackPath])
      // mark black file as "consumed"
      blackFiles[blackIdx] = null
    }
    else {
      // console.log(`no match: ${whitePath} ${blackPath}`)
      console.log(`no match: ${whitePath}.inv.png ${blackPath}`)
      // magick montage out/B0DTZ195XS/pages/white/0019-00100.png.inv.png out/B0DTZ195XS/pages/black/0019-00100.png -geometry +0+0 foo.png
      const args = [
        'magick',
        'montage',
        `${whitePath}.inv.png`,
        blackPath,
        '-geometry', '+0+0',
        `${whitePath}.mon.png`,
      ]
      console.log(`writing ${whitePath}.mon.png`)
      child_process.spawnSync(args[0], args.slice(1), {})
    }

    // find matching black file
  }
}

main()
