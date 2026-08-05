type LengthOfString<
  S extends string,
  Acc extends 0[] = []
> = S extends `${string}${infer $Rest}`
  ? LengthOfString<$Rest, [...Acc, 0]>
  : Acc['length']

export type HexNumbers =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'

export type HexCharsLower = 'a' | 'b' | 'c' | 'd' | 'e' | 'f'
export type HexCharsUpper = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export type HexLower = HexNumbers | HexCharsLower
export type HexUpper = HexNumbers | HexCharsUpper
export type Hex = HexNumbers | HexCharsLower | HexCharsUpper

export type HexString<S> =
  S extends ''
    ? unknown
    : S extends `${Hex}${infer Rest}`
      ? HexString<Rest>
      : never

declare function onlyHexString<S extends string>(
  hexString: S & HexString<S>
): any

// onlyHexString('abcdef1234567890')

export type EvmAddressType<S extends string = ''> =
  S extends ''
    ? never
    : LengthOfString<S> extends 42
      ? S extends `0x${infer Rest}`
        ? HexString<Rest>
        : never
      : never

declare function onlyEvmAddress<S extends string>(
  address: S & EvmAddressType<S>
): any
// onlyEvmAddress('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')

export type RelayFingerprint<S extends string = ''> = Uppercase<S> &
  S extends ''
    ? never
    : LengthOfString<S> extends 40
      ? HexString<S>
      : never

declare function onlyRelayFingerprint<S extends string>(
  fingerprint: S & RelayFingerprint<S>
): any

// onlyTorFingerprint('AAAAABBBBBCCCCCDDDDDEEEEEFFFFF0000011111')
