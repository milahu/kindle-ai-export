/*
white      black
0484-00200 0484-00200 funkgeräte
... matches ...
0487-00100 0487-00100 zubehör
0488-00100            39. gemeinschaft # FIXME missing black page. why?!
0488-00200 0488-00100 bild 35
*/

import 'dotenv/config'

import fs from 'node:fs/promises'
import path from 'node:path'
import child_process from 'node:child_process'

import looksSame from 'looks-same'

import { PNG } from 'pngjs'
import cv from 'opencv4nodejs'

import {


  getEnv,


} from './utils'

const asin = getEnv('ASIN')

// https://stackoverflow.com/questions/11247790/reading-a-png-image-in-node-js
// https://github.com/pngjs/pngjs#example
function imageInvertColors(image) {
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

function pageOfPath(p) {
  // example path:
  // out/B0DTZ195XS/pages/white/0061-00100-e0e0e116-59ff-49e0-aa53-438396bd81c4.png
  return Number(path.basename(p).split("-")[0])
}

async function findWhiteRectangles(imagePath) {
  // Read the image
  const img = await cv.imreadAsync(imagePath);
  // Convert to grayscale
  const gray = img.cvtColor(cv.COLOR_BGR2GRAY);
  // Threshold to get binary image (white=255, black=0)
  const thresholded = gray.threshold(200, 255, cv.THRESH_BINARY);
  // Find contours
  const contours = thresholded.findContours(
    cv.RETR_EXTERNAL,
    cv.CHAIN_APPROX_SIMPLE
  );
  const rectangles = [];
  for (const contour of contours) {
    // Approximate contour to polygon
    const epsilon = 0.02 * contour.arcLength(true);
    const approx = contour.approxPolyDP(epsilon, true);
    // If the polygon has 4 vertices, it's likely a rectangle
    if (approx.vertices.length === 4) {
      const rect = approx.boundingRect();
      rectangles.push({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      });
    }
  }
  return rectangles;
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
  let lastMatchWhiteIdx = -1
  const maxLastMatchDistance = 20

  for (let whiteIdx = 0; whiteIdx < whiteFiles.length; whiteIdx++) {
    const whitePath = `${whiteDir}/${whiteFiles[whiteIdx]}`
    const whitePage = pageOfPath(whitePath)
    if (whitePage != 61) continue; if (whitePage > 61) break // debug
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
      blackFiles[blackIdx] = ""
      lastMatchWhiteIdx = whiteIdx
    }
    else {
      // console.log(`no match: ${whitePath} ${blackPath}`)
      console.log(`no match: ${whitePath}.inv.png ${blackPath}`)
      const monPath = `${whitePath}.mon.png`
      {
        // magick montage out/B0DTZ195XS/pages/white/0019-00100.png.inv.png out/B0DTZ195XS/pages/black/0019-00100.png -geometry +0+0 foo.png
        const args = [
          'magick',
          'montage',
          `${whitePath}.inv.png`,
          blackPath,
          '-geometry', '+0+0',
          monPath,
        ]
        console.log(`writing ${monPath}`)
        console.log('>', args.join(' '))
        child_process.spawnSync(args[0], args.slice(1), {})
      }
      const diffPath = `${whitePath}.diff.png`
      {
        // TODO extract images
        // find large white squares in diffPath
        // magick compare $white $black -compose src -highlight-color black -lowlight-color white $white.diff.png
        const args = [
          'magick',
          'compare',
          whitePath,
          blackPath,
          '-compose', 'src',
          '-highlight-color', 'black',
          '-lowlight-color', 'white',
          diffPath,
        ]
        console.log(`writing ${diffPath}`)
        console.log('>', args.join(' '))
        child_process.spawnSync(args[0], args.slice(1), {})
      }

      const rectangles = findWhiteRectangles(diffPath)
      console.dir({ rectangles })
    }
    if ((whiteIdx - lastMatchWhiteIdx) > maxLastMatchDistance) {
      // seek back
    }
    // find matching black file
    // TODO
  }

  console.log('done. to remove tempfiles:')
  console.log(`  rm ${whiteDir}/*.inv.png ${whiteDir}/*.mon.png`)
}

main()
