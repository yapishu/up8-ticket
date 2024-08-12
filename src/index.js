const chunk = require('lodash.chunk')
const flatMap = require('lodash.flatmap')
const hash = require('hash.js')
const DRBG = require('hmac-drbg')
const more = require('more-entropy')
const ob = require('urbit-ob')
const secrets = require('secrets.js-grempe')
const zipWith = require('lodash.zipwith')
const crypto = require('crypto')

const GALOIS_BITSIZE = 8

/*
 * Strip a leading zero from a string.
 */
const unpad = str => {
  /* istanbul ignore next */
  if (!(str.slice(0, 1) === '0')) {
    /* istanbul ignore next */
    throw new Error('nonzero leading digit -- please report this as a bug!')
  }

  return str.substring(1)
}

/*
 * The XOR operator, as a function.
 */
const xor = (x, y) => x ^ y

/*
 * Generate a master ticket of the desired bitlength.
 *
 * Uses 'crypto.rng' to generate the required entropy.
 *
 * A buffer provided as the second argument will be XOR'd with the generated
 * bytes.  You can use this to provide your own entropy, generated elsewhere.
 *
 * @param  {Number}  nbits desired bitlength of ticket
 * @param  {Buffer}  addl an optional buffer of additional bytes
 * @return  {String}  a @q-encoded master ticket
 */
const gen_ticket_simple = (nbits, addl) => {
  const nbytes  = nbits / 8
  const entropy = crypto.rng(nbytes)
  const bytes =
      Buffer.isBuffer(addl)
    ? Buffer.from(
        zipWith(entropy, addl, xor)
      )
      .slice(0, nbytes)
    : entropy

  return ob.hex2patq(bytes.toString('hex'))
}

/*
 * Generate a master ticket of the desired bitlength.
 *
 * Uses both 'crypto.rng' and 'more-entropy' to generate the required entropy.
 * Bytes generated by 'more-entropy' are XOR'd with those provided by
 * 'crypto.rng'.
 *
 * A buffer provided as the second argument will be XOR'd with the generated
 * bytes.  You can use this to provide your own entropy, generated elsewhere.
 *
 * @param  {Number}  nbits desired bitlength of ticket
 * @param  {Buffer}  addl an optional buffer of additional bytes
 * @return  {Promise<String>}  a @q-encoded master ticket, wrapped in a Promise
 */
const gen_ticket_more = (nbits, addl) => {
  const nbytes = nbits / 8
  const prng = new more.Generator()

  return new Promise((resolve, reject) => {
    prng.generate(nbits, result => {
      const pairs   = chunk(result, 2)
      const entropy = pairs.slice(0, nbytes) // only take required entropy
      const more    = flatMap(entropy, arr => arr[0] ^ arr[1])

      const ticket    = gen_ticket_simple(nbits, more)
      const bufticket = Buffer.from(ob.patq2hex(ticket), 'hex')

      const bytes   =
          Buffer.isBuffer(addl)
        ? Buffer.from(
            zipWith(bufticket, addl, xor)
          )
          .slice(0, nbytes)
        : bufticket

      resolve(ob.hex2patq(bytes.toString('hex')))
      reject("entropy generation failed")
    })
  })
}

/*
 * Generate a master ticket of the desired bitlength.
 *
 * Uses both 'crypto.rng' and 'more-entropy' to produce the required entropy
 * and nonce for input to a HMAC-DRBG generator, respectively.
 *
 * A buffer provided as the second argument will be used as the DRBG
 * personalisation string.
 *
 * @param  {Number}  nbits desired bitlength of ticket (minimum 192)
 * @param  {Buffer}  addl an optional buffer of additional bytes
 * @return  {Promise<String>}  a @q-encoded master ticket, wrapped in a Promise
 */
const gen_ticket_drbg = async (nbits, addl) => {
  const nbytes = nbits / 8
  const entropy = crypto.rng(nbytes)

  const prng  = new more.Generator()
  const nonce = await new Promise((resolve, reject) => {
    prng.generate(nbits, result => {
      resolve(result.toString('hex'))
      reject("entropy generation failed")
    })
  })

  const d = new DRBG({
    hash: hash.sha256,
    entropy: entropy,
    nonce: nonce,
    pers: Buffer.isBuffer(addl) ? addl.toString('hex') : null
  })

  const bytes = d.generate(nbytes, 'hex')
  return ob.hex2patq(bytes)
}

/*
 * Shard a ticket via a k/n Shamir's Secret Sharing scheme.
 *
 * Provided with a ticket, a desired number of shards 'n', and threshold value
 * 'k' < 'n', returns an array of 'n' shards such that the original ticket can
 * be recovered by combining at least 'k' of the shards together.  Each shard
 * leaks no information about the ticket.
 *
 * @param  {String}  ticket a @q-encoded string
 * @param  {Number}  n the desired number of shards to produce
 * @param  {Number}  k the desired threshold value, smaller than 'n'
 * @return  {Array<String>}  an array of 'n' @q-encoded shards
 */
const shard = (ticket, n, k) => {
  if (!ob.isValidPatq(ticket)) {
    throw new Error('input is not @q-encoded')
  }

  secrets.init(GALOIS_BITSIZE)

  const hex = ob.patq2hex(ticket)
  const shards = secrets.share(hex, n, k)
  return shards.map(ob.hex2patq)
}

/*
 * Combine shards that have been produced via 'shard'.
 *
 * Provide an array of shards in any order.  So long as at least 'k' shards
 * produced with a threshold value of 'k' are provided, they'll combine to
 * produce the intended ticket.
 *
 * @param  {Array<String>}  shards an array of @q-encoded shards
 * @return  {String}  a @q-encoded ticket
 */
const combine = shards => {
  const hexshards = shards.map(ob.patq2hex).map(unpad)
  const hexticket = secrets.combine(hexshards)
  return ob.hex2patq(hexticket)
}

module.exports = {
  gen_ticket_simple,
  gen_ticket_more,
  gen_ticket_drbg,

  shard,
  combine
}
