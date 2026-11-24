// Weighted vertex layout, shared by the check, the path repair and the binary writer.
//
// Spine stores a weighted vertex as [count, (boneIndex, x, y, weight) * count], one group per
// vertex, back to back. An unweighted attachment stores plain x, y pairs instead. These two
// readers were written twice before (check.js and path-fix.js); one copy keeps them in step.

/** True when `v` is exactly `groups` weighted groups and nothing else. */
export function weightedGroupsExact(v, groups) {
  let i = 0;
  for (let g = 0; g < groups; g++) {
    const n = v[i++];
    if (!Number.isInteger(n) || n <= 0 || i + n * 4 > v.length) return false;
    i += n * 4;
  }
  return i === v.length;
}

/** True when `v` is a well-formed run of weighted groups whose bone indices are in range. */
export function weightedVerticesValid(v, boneCount) {
  let i = 0;
  while (i < v.length) {
    const count = v[i++];
    if (!Number.isInteger(count) || count <= 0 || i + count * 4 > v.length) return false;
    for (let k = 0; k < count; k++, i += 4) {
      const bone = v[i];
      if (!Number.isInteger(bone) || bone < 0 || bone >= boneCount) return false;
    }
  }
  return true;
}
