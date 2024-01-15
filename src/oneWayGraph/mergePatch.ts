/*
Contents of this file is from: https://github.com/riagominota/ts-merge-patch

License:

MIT License

Copyright (c) 2022 Matt Fox/riagominota

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

type mpObj<T> = { [k in keyof T | string | number | symbol]: any };
export function mergePatch<L, R>(
  target: mpObj<L>,
  patchItem: mpObj<R>,
): Partial<L> & Partial<R>;
export function mergePatch<L, R>(target: mpObj<L>, patchItem: mpObj<R>): R;
export function mergePatch<L, R>(target: mpObj<L>, patchItem: mpObj<R>): {};
export function mergePatch<L, R>(target: mpObj<L>, patchItem: null): null;
export function mergePatch<L, R>(target: mpObj<L>, patchItem: string): string;
export function mergePatch<L, R>(target: mpObj<L>, patchItem: number): number;
export function mergePatch<L, R>(
  target: mpObj<L>,
  patchItem: undefined,
): undefined;
export function mergePatch<L, R>(target: mpObj<L>, patchItem: R[]): R[];

//this mutates target
//if
export function mergePatch(target: any, patchItem: any): any {
  /**
   * If the patch is anything other than an object,
   * the result will always be to replace
   * the entire target with the entire patch.
   */
  if (typeof patchItem !== 'object' || Array.isArray(patchItem) || !patchItem) {
    return JSON.parse(JSON.stringify(patchItem)); //return new instance of variable
  }

  if (
    typeof patchItem === 'object' &&
    patchItem.toJSON !== undefined &&
    typeof patchItem.toJSON === 'function'
  ) {
    return patchItem.toJSON();
  }
  /** Also, it is not possible to
   * patch part of a target that is not an object,
   * such as to replace just some of the values in an array.
   */
  let targetResult = target;
  if (typeof target !== 'object') {
    //Target is empty/not an object, so basically becomes patch, minus any null valued sections (becomes {} + patch)
    targetResult = { ...patchItem };
  }

  Object.keys(patchItem).forEach((k) => {
    if (!targetResult.hasOwnProperty(k)) targetResult[k] = patchItem[k]; //This ensure the key exists and TS can't throw a wobbly over an undefined key
    if (patchItem[k] === null) {
      delete targetResult[k];
    } else {
      targetResult[k] = mergePatch(targetResult[k], patchItem[k]);
    }
  });
  return targetResult;
}
