import fs from 'fs'
import path from 'path'
import {isHidden} from 'is-hidden'
import {iso6393} from 'iso-639-3'
import {speakers} from 'speakers'
import {unified} from 'unified'
import rehypeParse from 'rehype-parse'
import gfm from 'remark-gfm'
import stringify from 'remark-stringify'
import {select, selectAll} from 'hast-util-select'
import {toString} from 'hast-util-to-string'
import parseAuthor from 'parse-author'
import alphaSort from 'alpha-sort'
import {min} from 'trigrams'
import unicode from '@unicode/unicode-14.0.0'
import {customFixtures} from './custom-fixtures.js'

const own = {}.hasOwnProperty

const ascending = alphaSort()
const scripts = unicode.Script

const core = process.cwd()
const root = path.join(core, 'packages')
const mono = JSON.parse(fs.readFileSync('package.json'))

// ISO 639-3 types to ignore.
const iso6393TypeExclude = new Set(['special'])

// Some languages are ignored, no matter what `threshold` is chosen.
const iso6393Exclude = new Set([
  // Same UDHR as ckb (Central Kurdish), but with less speakers.
  'kmr' // Northern Kurdish
])

const udhrKeyPrefer = new Set([
  /* Asante: 2,800,000; Fante: 1,900,000; Akuapem: 555,000.
   * http://www.ethnologue.com/language/aka */
  'aka_asante',

  // Occitan:
  // Provençal (before 2007: `prv`): ±350k 30 years ago;
  // Auvergnat (before 2007: `auv`) ±80k;
  // Languedocien (before 2007: `lnc`) ±300k;
  //
  // I’m not sure why `oci_1`, `oci_2`, `oci_3`, `oci_4` are classified
  // as `oci`, because they’re explained as Francoprovençal, Fribourg;
  // Francoprovençal, Savoie; Francoprovençal, Vaud;
  // and Francoprovençal, Valais;
  // which seems to be the language Franco-Provençal with a different
  // ISO code?
  'lnc',

  // In 2015 Unicode added lowercase Cherokee support (which people use
  // in handwriting), so prefer that one.
  'chr_cased',

  // Languages with dated translations, pick the newest.
  'deu_1996',
  'ron_2006',

  // Monotonic Greek is modern greek.
  'ell_monotonic',

  // It says “popular” in the name?
  'hat_popular',

  // Seems to be most popular in Nigeria:
  // <http://www.ethnologue.com/language/hau>
  'hau_NG',

  // Huastec
  // About 250k speakers.
  // `hva` (San Luís Potosí) — 48k
  // `hus` (Veracruz) — 22k
  // `hsf` (Sierra de Otontepec) — 12k
  'hva',

  // No real reason. <http://www.ethnologue.com/language/nya>
  'nya_chinyanja',

  // Many more speakers than European.
  'por_BR',

  // Tso in mozambique has a UDHR preview: http://www.ohchr.org/EN/UDHR/Pages/Language.aspx?LangID=tso
  'tso_MZ'
])

const iso15924Exclude = new Set([
  // Note these are ISO 15924 PvA’s, used for Unicode Scripts.
  'Common',
  'Inherited'
])

// Update some counts (`speakers` uses macrolanguage)
// Standard Estonian from inclusive code.
speakers.ekk = speakers.ekk || speakers.est
// Standard Lavian from inclusive code.
speakers.lvs = speakers.lvs || speakers.lav

// Map of languages where trigrams don’t work, but with a unique script.
const scriptsForSingleLanguages = {
  sat: {script: 'Ol_Chiki', udhr: undefined},
  iii: {script: 'Yi', udhr: 'iii'},
  cmn: {script: 'Han', udhr: 'cmn_hans'}
}

main()

// eslint-disable-next-line complexity
async function main() {
  const trigrams = await min()
  const expressions = await createExpressions()
  const topLanguages = createTopLanguages()
  const doc = fs.readFileSync(path.join(root, 'franc', 'index.js'), 'utf8')
  const files = fs.readdirSync(root)
  let index = -1

  while (++index < files.length) {
    const basename = files[index]

    if (isHidden(basename)) continue

    const base = path.join(root, basename)
    const pack = JSON.parse(fs.readFileSync(path.join(base, 'package.json')))
    const threshold = pack.threshold
    const support = []
    const regularExpressions = {} /* Ha! */
    const perScript = {}
    const data = {}
    let list = topLanguages

    if (!threshold) {
      console.log('\nNo `threshold` field in `%s`', pack.name)
      continue
    }

    console.log()
    console.log('%s, threshold: %s', pack.name, threshold)

    if (threshold !== -1) {
      list = list.filter((info) => info.speakers >= threshold)
    }

    const byScript = {}
    let offset = -1

    while (++offset < list.length) {
      const info = list[offset]
      const script = info.script

      if (!byScript[script]) {
        byScript[script] = []
      }

      byScript[script].push(info)
    }

    let script

    for (script in byScript) {
      if (own.call(byScript, script)) {
        const languages = byScript[script]

        if (languages.length > 1) {
          if (!regularExpressions[script]) {
            regularExpressions[script] = expressions[script]
          }

          perScript[script] = languages
        } else {
          support.push(languages[0])
          regularExpressions[languages[0].code] = expressions[script]
        }
      }
    }

    for (script in perScript) {
      if (own.call(perScript, script)) {
        const scripts = perScript[script]
        const scriptObject = {}
        let index = -1

        data[script] = scriptObject

        while (++index < scripts.length) {
          const info = scripts[index]

          if (info.udhr in trigrams) {
            support.push(info)
            scriptObject[info.code] = trigrams[info.udhr]
              .concat()
              .reverse()
              .join('|')
          } else {
            console.log(
              '  Ignoring language without trigrams: %s (%s, %s)',
              info.code,
              info.name,
              script
            )
          }
        }
      }
    }

    // Push Japanese.
    // Unicode Kanji Table from:
    // <http://www.rikai.com/library/kanjitables/kanji_codes.unicode.shtml>
    const kanjiRegexSource = '[\u3400-\u4DB5\u4E00-\u9FAF]'
    regularExpressions.jpn = new RegExp(
      expressions.Hiragana.source +
        '|' +
        expressions.Katakana.source +
        '|' +
        kanjiRegexSource,
      'g'
    )

    support.sort(sort)

    fs.writeFileSync(
      path.join(base, 'expressions.js'),
      generateExpressions(regularExpressions)
    )

    fs.writeFileSync(
      path.join(base, 'data.js'),
      'export const data = ' + JSON.stringify(data, null, 2) + '\n'
    )

    fs.writeFileSync(
      path.join(base, 'readme.md'),
      generateReadme(pack, support)
    )

    if (pack.name !== mono.name) {
      fs.writeFileSync(
        path.join(base, 'index.js'),
        '// This file is generated by `build.js`\n' + doc
      )
    }

    console.log('✓ %s w/ %s languages', pack.name, list.length)

    if (pack.name !== mono.name) {
      continue
    }

    console.log()
    console.log('Creating fixtures')

    const fixtures = {}
    offset = -1

    while (++offset < support.length) {
      const language = support[offset]
      const key = language.udhr || language.code
      let fixture = ''

      if (key in customFixtures) {
        fixture = customFixtures[key]
      } else if (language.udhr) {
        const tree = unified()
          .use(rehypeParse)
          .parse(
            fs.readFileSync(
              path.join(
                'node_modules',
                'udhr',
                'declaration',
                language.udhr + '.html'
              )
            )
          )

        let nodes = selectAll('header p', tree)

        if (nodes.length === 0) {
          nodes = selectAll(
            'body > :matches(h1, h2, h3, h4, h5, h6), header :matches(h1, h2, h3, h4, h5, h6)',
            tree
          )
        }

        fixture = nodes.map((d) => toString(d)).join(' ')
      }

      if (!fixture) {
        console.log(
          '  Could not access preamble or note for `%s` (%s). No fixture is generated.',
          language.code,
          language.udhr
        )
      }

      fixtures[key] = {
        iso6393: language.code,
        fixture: fixture.slice(0, 1000)
      }
    }

    fs.writeFileSync(
      path.join(core, 'test', 'fixtures.js'),
      'export const fixtures = ' + JSON.stringify(fixtures, null, 2) + '\n'
    )

    console.log('✓ fixtures')
  }

  function generateExpressions(expressions) {
    return [
      '// This file is generated by `build.js`.',
      'export const expressions = {',
      '  ' +
        Object.keys(expressions)
          .map((script) => script + ': ' + expressions[script])
          .join(',\n  '),
      '}',
      ''
    ].join('\n')
  }

  function generateReadme(pack, list) {
    const threshold = pack.threshold
    const counts = count(list)
    const licensee = parseAuthor(pack.author)
    const tree = {
      type: 'root',
      children: [
        {type: 'html', value: '<!--This file is generated by `build.js`-->'},
        {
          type: 'heading',
          depth: 1,
          children: [{type: 'text', value: pack.name}]
        },
        {
          type: 'blockquote',
          children: [
            {
              type: 'paragraph',
              children: [{type: 'text', value: pack.description + '.'}]
            }
          ]
        },
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              value:
                'Built with support for ' +
                list.length +
                ' languages' +
                (threshold === -1
                  ? ''
                  : ' (' +
                    threshold.toLocaleString('en', {notation: 'compact'}) +
                    ' or more speakers)') +
                '.'
            }
          ]
        },
        {
          type: 'paragraph',
          children: [
            {type: 'text', value: 'View the '},
            {
              type: 'link',
              url: mono.repository,
              children: [{type: 'text', value: 'monorepo'}]
            },
            {type: 'text', value: ' for more packages and\nusage information.'}
          ]
        },
        {
          type: 'heading',
          depth: 2,
          children: [{type: 'text', value: 'Install'}]
        },
        {
          type: 'paragraph',
          children: [
            {type: 'text', value: 'This package is '},
            {
              type: 'link',
              url: 'https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c',
              children: [{type: 'text', value: 'ESM only'}]
            },
            {
              type: 'text',
              value: ':\nNode 12+ is needed to use it and it must be\n'
            },
            {type: 'inlineCode', value: 'import'},
            {type: 'text', value: 'ed instead of '},
            {type: 'inlineCode', value: 'require'},
            {type: 'text', value: 'd.'}
          ]
        },
        {type: 'paragraph', children: [{type: 'text', value: 'npm:'}]},
        {type: 'code', lang: 'sh', value: 'npm install ' + pack.name},
        {
          type: 'heading',
          depth: 2,
          children: [{type: 'text', value: 'Support'}]
        },
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              value: 'This build supports the following languages:'
            }
          ]
        },
        {
          type: 'table',
          align: [],
          children: [
            {
              type: 'tableRow',
              children: [
                {type: 'tableCell', children: [{type: 'text', value: 'Code'}]},
                {type: 'tableCell', children: [{type: 'text', value: 'Name'}]},
                {
                  type: 'tableCell',
                  children: [{type: 'text', value: 'Speakers'}]
                }
              ]
            },
            ...list.map((info) => ({
              type: 'tableRow',
              children: [
                {
                  type: 'tableCell',
                  children: [
                    {
                      type: 'link',
                      url:
                        'http://www-01.sil.org/iso639-3/documentation.asp?id=' +
                        info.code,
                      title: null,
                      children: [{type: 'inlineCode', value: info.code}]
                    }
                  ]
                },
                {
                  type: 'tableCell',
                  children: [
                    {
                      type: 'text',
                      value:
                        info.name +
                        (counts[info.code] === 1
                          ? ''
                          : ' (' + info.script + ')')
                    }
                  ]
                },
                {
                  type: 'tableCell',
                  children: [
                    {
                      type: 'text',
                      value:
                        typeof info.speakers === 'number'
                          ? info.speakers.toLocaleString('en', {
                              notation: 'compact',
                              maximumFractionDigits: 0
                            })
                          : 'unknown'
                    }
                  ]
                }
              ]
            }))
          ]
        },
        {
          type: 'heading',
          depth: 2,
          children: [{type: 'text', value: 'License'}]
        },
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: mono.repository + '/blob/main/license',
              children: [{type: 'text', value: mono.license}]
            },
            {type: 'text', value: ' © '},
            {
              type: 'link',
              url: licensee.url,
              children: [{type: 'text', value: licensee.name}]
            }
          ]
        }
      ]
    }

    return unified().use(stringify).use(gfm).stringify(tree)
  }

  function count(list) {
    const map = {}
    let index = -1

    while (++index < list.length) {
      const info = list[index]
      map[info.code] = (map[info.code] || 0) + 1
    }

    return map
  }

  /* Sort a list of languages by most-popular. */
  function sort(a, b) {
    return (
      (b.speakers || 0) - (a.speakers || 0) ||
      ascending(a.name, b.name) ||
      ascending(a.script, b.script)
    )
  }

  // eslint-disable-next-line complexity
  function createTopLanguages() {
    const top = []
    let udhrKey

    for (udhrKey in trigrams) {
      if (own.call(trigrams, udhrKey)) {
        const declaration = String(
          fs.readFileSync(
            path.join('node_modules', 'udhr', 'declaration', udhrKey + '.html')
          )
        )
        const tree = unified().use(rehypeParse).parse(declaration)
        const root = select('html', tree)
        const code =
          (root && root.properties && root.properties.dataIso6393) || undefined

        if (typeof code !== 'string') {
          throw new TypeError(
            'Missing `html[data-iso6393]` in `' + udhrKey + '`'
          )
        }

        const info = iso6393.find((d) => d.iso6393 === code)

        if (!info) {
          throw new Error(
            'Could not find valid `iso-639-3` entry for `' + code + '`'
          )
        }

        if (iso6393TypeExclude.has(info.type)) {
          console.log('Ignoring special code `%s`', udhrKey)
          continue
        }

        if (iso6393Exclude.has(code)) {
          console.log('Ignoring unsafe language `%s`', udhrKey)
          continue
        }

        let content = ''

        if (info) {
          content = selectAll('article p', root)
            .map((d) => toString(d))
            .join(' ')
        }

        const scriptCounts = {}
        let script

        for (script in expressions) {
          if (own.call(expressions, script) && !iso15924Exclude.has(script)) {
            const countMatch = content.match(expressions[script])
            const count =
              Math.round(
                ((countMatch ? countMatch.length : 0) / content.length) * 100
              ) / 100

            if (count > 0.05) {
              scriptCounts[script] = count
            }
          }
        }

        // Japanese is different.
        const scripts =
          code === 'jpn'
            ? ['Hiragana, Katakana, and Han']
            : Object.keys(scriptCounts)

        if (scripts.length > 1) {
          throw new Error(
            'Woops, I found a declaration (`' +
              udhrKey +
              '`) which uses more than one script. Franc is not build for that. Exiting.'
          )
        }

        const lettersOnly = udhrKey.replace(/[^a-z]+/g, '')

        let score = 1

        if (udhrKeyPrefer.has(udhrKey)) {
          score *= 2
        } else {
          // Loose points for number of underscores and digits.
          score /= udhrKey.length - lettersOnly.length + 1
        }

        top.push({
          score,
          // Can `name` and `type` be removed?
          name: info.name,
          code,
          udhr: udhrKey,
          script: scripts[0],
          speakers: speakers[code]
        })
      }
    }

    let index = -1
    while (++index < iso6393.length) {
      const {name, iso6393: code} = iso6393[index]

      // Manual scripts for languages without trigrams.
      if (own.call(scriptsForSingleLanguages, code)) {
        const info = scriptsForSingleLanguages[code]
        top.push({
          score: 1,
          // Can `name` be removed?
          name,
          code,
          udhr: info.udhr,
          script: info.script,
          speakers: speakers[code]
        })
      }
    }

    const byIsoAndScript = {}

    for (const d of top) {
      const key = d.code + ':' + d.script
      const list = byIsoAndScript[key] || (byIsoAndScript[key] = [])
      list.push(d)
    }

    const bestScores = []
    let key

    for (key in byIsoAndScript) {
      if (own.call(byIsoAndScript, key)) {
        const list = byIsoAndScript[key]

        // High score first.
        list.sort((a, b) => b.score - a.score)

        if (list[1] && list[0].score === list[1].score) {
          console.log(
            'Not sure which one to pick, please prefer one specific UDHR key',
            list
          )
        }

        bestScores.push(list[0])
      }
    }

    return bestScores.sort(sort)
  }
}

async function createExpressions() {
  const result = {}

  await Promise.all(
    scripts.map((script) =>
      import('@unicode/unicode-14.0.0/Script/' + script + '/regex.js').then(
        (mod) => {
          result[script] = new RegExp(mod.default.source, 'g')
        }
      )
    )
  )

  return result
}
