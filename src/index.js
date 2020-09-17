const more = require('more-entropy')
const ob = require('urbit-ob')
const chunk = require('lodash.chunk')
const flatMap = require('lodash.flatmap')
const zipWith = require('lodash.zipwith')

const gen = bits => {
  const bytes = bits / 8
  const some  = crypto.rng(bytes)

  const prng = new more.Generator()

  return new Promise((resolve, reject) => {
    prng.generate(bits, result =>  {
      const chunked = chunk(result, 2)
      const desired = chunked.slice(0, bytes) // only take required entropy
      const more    = flatMap(desired, arr => arr[0] ^ arr[1])
      const entropy = zipWith(some, more, (x, y) => x ^ y)
      const buf     = Buffer.from(entropy)
      const patq    = ob.hex2patq(buf.toString('hex'))
      resolve(patq)
      reject("entropy generation failed")
    })
  })
}

module.exports = {
  gen: gen
}