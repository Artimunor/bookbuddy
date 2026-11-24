import { SESSIONS_FEATURE_FLAG } from "@bookbuddy/domain";
import { at } from "../access/policy";
import { currentPerson, placeViewer } from "../places/policy";

const sessionsFlags = `flag.key = '${SESSIONS_FEATURE_FLAG}' AND flag.enabled = 1`;
const enabledFlag = (scope: string) => `EXISTS (SELECT 1 FROM feature_flags flag WHERE ${sessionsFlags} AND flag.scope_key = ${scope})`;

export const sessionsBusinessEnabled = (businessId: string) => enabledFlag(businessId);
export const sessionsCategoryEnabled = (areaId: string, category: string) => enabledFlag(`${areaId} || ':' || ${category}`);
export const sessionsCategories = (areaId: string) => `SELECT substr(flag.scope_key, length(${areaId}) + 2) AS category
  FROM feature_flags flag WHERE ${sessionsFlags} AND flag.scope_key > ${areaId} || ':' AND flag.scope_key < ${areaId} || ';'`;
export const sessionsMarketEnabled = (areaId: string) => `EXISTS (${sessionsCategories(areaId)})`;

export const sessionsCustomerPlace = (place: string, person: string, accountId: string, now = at) =>
  `${person}.account_id = ${accountId} AND ${place}.state = 'in_area' AND ${currentPerson(person, now)}
    AND ${placeViewer(place, `${person}.account_id`, now)}`;

export const sessionsCustomerMarket = (accountId: string, areaId: string, now = at) => `EXISTS (
  SELECT 1 FROM place_people pp JOIN places p ON p.id = pp.place_id
  WHERE p.area_id = ${areaId} AND ${sessionsCustomerPlace("p", "pp", accountId, now)})`;

export const sessionsCustomerCategory = (accountId: string, areaId: string, category: string, now = at) =>
  `(${sessionsCategoryEnabled(areaId, category)} AND ${sessionsCustomerMarket(accountId, areaId, now)})`;

export const sessionsCustomerTarget = (accountId: string, businessId: string, areaId: string, category: string, now = at) =>
  `(${sessionsBusinessEnabled(businessId)} AND ${sessionsCustomerCategory(accountId, areaId, category, now)})`;
