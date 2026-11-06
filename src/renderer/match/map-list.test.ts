import { describe, expect, it } from "vitest";
import { pushToMap, pushUniqueToMap } from "./map-list";

describe("pushToMap", () => {
  it("未登録キーへ積むと新規配列が作られる", () => {
    const map = new Map<string, number[]>();
    pushToMap(map, "a", 1);
    expect(map.get("a")).toEqual([1]);
  });

  it("既存キーへ積むと配列へ追記される", () => {
    const map = new Map<string, number[]>([["a", [1]]]);
    pushToMap(map, "a", 2);
    expect(map.get("a")).toEqual([1, 2]);
  });

  it("同一値を2回積むとどちらも積まれる", () => {
    const map = new Map<string, number[]>();
    pushToMap(map, "a", 1);
    pushToMap(map, "a", 1);
    expect(map.get("a")).toEqual([1, 1]);
  });
});

describe("pushUniqueToMap", () => {
  it("同一値（プリミティブ）はすでにあれば積まない", () => {
    const map = new Map<string, number[]>();
    pushUniqueToMap(map, "a", 1);
    pushUniqueToMap(map, "a", 1);
    expect(map.get("a")).toEqual([1]);
  });

  it("同一オブジェクト参照はすでにあれば積まないが、等値だが別参照のオブジェクトは積む", () => {
    const objMap = new Map<string, { v: number }[]>();
    const obj1 = { v: 1 };
    pushUniqueToMap(objMap, "a", obj1);
    pushUniqueToMap(objMap, "a", obj1);
    expect(objMap.get("a")).toEqual([obj1]);

    const obj2 = { v: 1 };
    pushUniqueToMap(objMap, "a", obj2);
    expect(objMap.get("a")).toEqual([obj1, obj2]);
  });
});
