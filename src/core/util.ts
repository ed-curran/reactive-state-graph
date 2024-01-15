export type TypedArray<M extends any> = [...M[]];
export type NonEmptyTypedArray<M extends any> = [M, ...M[]];
