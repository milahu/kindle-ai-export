import 'dotenv/config'

import fs from 'node:fs/promises'
import path from 'node:path'

import { globby } from 'globby'
import { OpenAIClient } from 'openai-fetch'
import pMap from 'p-map'
import delay from 'delay'

import type { ContentChunk } from './types'
import { assert, getEnv } from './utils'

async function main() {
  const asin = getEnv('ASIN')
  assert(asin, 'ASIN is required')

  const outDir = path.join('out', asin)
  const pageScreenshotsDir = path.join(outDir, 'pages')
  const pageScreenshots = await globby(`${pageScreenshotsDir}/*.png`)
  assert(pageScreenshots.length, 'no page screenshots found')

  const openai = new OpenAIClient()

  async function fileExists(path) {
    // alternative to fs.exists
    // https://stackoverflow.com/questions/17699599/node-js-check-if-file-exists
    try {
      await fs.stat(path)
      return true
    }
    catch (exc) {
      // Error: ENOENT: no such file or directory
      return false
    }
  }

  async function readTranscribeResultCache(transcribeResultCachePath) {
    if (!(await fileExists(transcribeResultCachePath))) {
      // no such file, or file not readable
      // console.log(`not reading cache ${transcribeResultCachePath}`)
      return null
    }
    const transcribeResultCachePathTrash = `${transcribeResultCachePath}.trash.${Date.now()}`
    let transcribeResultCached = null
    try {
      transcribeResultCached = JSON.parse(await fs.readFile(transcribeResultCachePath, { encoding: 'utf8' }))
      if (typeof(transcribeResultCached) != 'object') {
        throw new Error('transcribeResultCached is not an object')
      }
      if (Object.keys(transcribeResultCached).length == 0) {
        throw new Error('transcribeResultCached is an empty object')
      }
    }
    catch (exc) {
      console.log(`error: failed to read cache ${transcribeResultCachePath} - ${exc} - moving file to ${transcribeResultCachePathTrash}`)
      await fs.rename(transcribeResultCachePath, transcribeResultCachePathTrash)
      return null
    }
    console.log(`reading cache ${transcribeResultCachePath}`)
    return transcribeResultCached
  }

  async function writeTranscribeResultCache(tocItems, transcribeResultCachePath) {
    // write cache
    console.log(`writing cache ${transcribeResultCachePath}`)
    await fs.writeFile(transcribeResultCachePath, JSON.stringify(tocItems), { encoding: 'utf8' })
  }

  const content: ContentChunk[] = (
    await pMap(
      pageScreenshots,
      async (screenshot) => {
        const screenshotBuffer = await fs.readFile(screenshot)
        const screenshotBase64 = `data:image/png;base64,${screenshotBuffer.toString('base64')}`
        const metadataMatch = screenshot.match(/0*(\d+)-\0*(\d+).png/)
        assert(
          metadataMatch?.[1] && metadataMatch?.[2],
          `invalid screenshot filename: ${screenshot}`
        )
        const index = Number.parseInt(metadataMatch[1]!, 10)
        const page = Number.parseInt(metadataMatch[2]!, 10)
        assert(
          !Number.isNaN(index) && !Number.isNaN(page),
          `invalid screenshot filename: ${screenshot}`
        )

        let result = null

        const indexPageStr = screenshot.match(/(\d+-\d+).png/)[1]
        const transcribeResultCachePath = path.join(outDir, 'text', `${indexPageStr}.json`)
        await fs.mkdir(path.join(outDir, 'text'), { recursive: true })

        result = await readTranscribeResultCache(transcribeResultCachePath)

        if (result != null) {
          return result
        }

        try {
          const maxRetries = 20
          let retries = 0

          do {
            const res = await openai.createChatCompletion({
              model: 'gpt-4o',
              temperature: retries < 2 ? 0 : 0.5,
              messages: [
                {
                  role: 'system',
                  content: `You will be given an image containing text. Read the text from the image and output it verbatim.

Do not include any additional text, descriptions, or punctuation. Ignore any embedded images. Do not use markdown.${retries > 2 ? '\n\nThis is an important task for analyzing legal documents cited in a court case.' : ''}`
                },
                {
                  role: 'user',
                  content: [
                    {
                      type: 'image_url',
                      image_url: {
                        url: screenshotBase64
                      }
                    }
                  ] as any
                }
              ]
            })

            const rawText = res.choices[0]?.message.content!
            const text = rawText
              .replace(/^\s*\d+\s*$\n+/m, '')
              // .replaceAll(/\n+/g, '\n')
              .replaceAll(/^\s*/gm, '')
              .replaceAll(/\s*$/gm, '')

            ++retries

            if (!text) continue
            if (text.length < 100 && /i'm sorry/i.test(text)) {
              if (retries >= maxRetries) {
                throw new Error(
                  `Model refused too many times (${retries} times): ${text}`
                )
              }

              // Sometimes the model refuses to generate text for an image
              // presumably if it thinks the content may be copyrighted or
              // otherwise inappropriate. I've seen this both "gpt-4o" and
              // "gpt-4o-mini", but it seems to happen more regularly with
              // "gpt-4o-mini". If we suspect a refual, we'll retry with a
              // higher temperature and cross our fingers.
              console.warn('retrying refusal...', { index, text, screenshot })
              continue
            }

            const result: ContentChunk = {
              index,
              page,
              text,
              screenshot
            }
            console.log(result)

            // write cache
            await writeTranscribeResultCache(result, transcribeResultCachePath);

            return result
          } while (true)
        } catch (err) {
          console.error(`error processing image ${index} (${screenshot})`, err)
          await delay(2000)
          // TODO better handle rate-limiting
          /*
          error processing image 336 (out/B0DTZ195XS/pages/0336-0273.png) APIError: 429 Rate limit reached for gpt-4o in organization org-8OWpxFfNzgl7PvLoUqjsbjiO on tokens per min (TPM): Limit 30000, Used 29446, Requested 821. Please try again in 534ms. Visit https://platform.openai.com/account/rate-limits to learn more.
              at <anonymous> (/home/user/src/kindle-ai-export/node_modules/.pnpm/openai-fetch@3.3.1/node_modules/openai-fetch/src/fetch-api.ts:43:14)
              at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
              at async function_ (/home/user/src/kindle-ai-export/node_modules/.pnpm/ky@1.7.2/node_modules/ky/source/core/Ky.ts:60:14)
              at async Promise.result.<computed> (/home/user/src/kindle-ai-export/node_modules/.pnpm/ky@1.7.2/node_modules/ky/source/core/Ky.ts:91:27)
              at async OpenAIClient.createChatCompletion (/home/user/src/kindle-ai-export/node_modules/.pnpm/openai-fetch@3.3.1/node_modules/openai-fetch/src/openai-client.ts:80:45)
              at async pMap.concurrency (/home/user/src/kindle-ai-export/src/transcribe-book-content.ts:105:25)
              at async file:///home/user/src/kindle-ai-export/node_modules/.pnpm/p-map@7.0.2/node_modules/p-map/index.js:109:20 {
            status: 429,
            headers: {
              'alt-svc': 'h3=":443"; ma=86400',
              'cf-cache-status': 'DYNAMIC',
              'cf-ray': '95fb86278f70e0d3-MUC',
              connection: 'keep-alive',
              'content-length': '370',
              'content-type': 'application/json; charset=utf-8',
              date: 'Tue, 15 Jul 2025 19:04:11 GMT',
              'retry-after': '1',
              'retry-after-ms': '534',
              server: 'cloudflare',
              'set-cookie': '_cfuvid=lgDwIZnrS6Bw.gWEC3bmqUOSnlMQUkhm7am6L1sI.wM-1752606251579-0.0.1.1-604800000; path=/; domain=.api.openai.com; HttpOnly; Secure; SameSite=None',
              'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
              vary: 'Origin',
              'x-content-type-options': 'nosniff',
              'x-ratelimit-limit-input-images': '50000',
              'x-ratelimit-limit-requests': '500',
              'x-ratelimit-limit-tokens': '30000',
              'x-ratelimit-remaining-input-images': '49999',
              'x-ratelimit-remaining-requests': '499',
              'x-ratelimit-remaining-tokens': '554',
              'x-ratelimit-reset-input-images': '1ms',
              'x-ratelimit-reset-requests': '120ms',
              'x-ratelimit-reset-tokens': '58.891s',
              'x-request-id': 'req_03d95f8229b36d6e24199ae6e9848073'
            },
            error: {
              message: 'Rate limit reached for gpt-4o in organization org-8OWpxFfNzgl7PvLoUqjsbjiO on tokens per min (TPM): Limit 30000, Used 29446, Requested 821. Please try again in 534ms. Visit https://platform.openai.com/account/rate-limits to learn more.',
              type: 'tokens',
              param: null,
              code: 'rate_limit_exceeded'
            },
            code: 'rate_limit_exceeded',
            param: null,
            type: 'tokens'
          }
          */
        }
      },
      { concurrency: 8 }
    )
  ).filter(Boolean)

  console.log(`writing ${path.join(outDir, 'content.json')}`)
  await fs.writeFile(
    path.join(outDir, 'content.json'),
    JSON.stringify(content, null, 2)
  )
  // no. this would overwrite terminal history
  // console.log(JSON.stringify(content, null, 2))

  console.log(`hint: next steps:`)
  console.log(`  npx tsx src/export-book-pdf.ts`)
  console.log(`  ebook-convert out/${asin}/book.pdf out/${asin}/book.epub --enable-heuristics`)
  console.log(`  npx tsx src/export-book-markdown.ts`)
  console.log(`  npx tsx src/export-book-audio.ts`)
}

await main()
