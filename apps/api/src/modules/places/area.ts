import type { SessionAccess } from "../auth/session";

interface Pin { latitude: number; longitude: number }

// The stored polygon is [outer ring, ...holes], each a list of [longitude,
// latitude] pairs. Query in the command batch, not a preflight read; the same
// area version supplies the matched ID and site zone. No outside zone is guessed.
export function withPinArea(access: SessionAccess, pin: Pin): SessionAccess {
  return { params: [...access.params, pin.longitude, pin.latitude], sql: `${access.sql},
    pin_input(x, y) AS (VALUES (?, ?)),
    pin_vertices AS (
      SELECT a.id AS area_id, r.key AS ring, v.key AS vertex,
        CASE WHEN v.type = 'array' THEN CASE WHEN json_array_length(v.value) = 2
          AND json_type(v.value, '$[0]') IN ('integer', 'real') AND json_type(v.value, '$[1]') IN ('integer', 'real')
          THEN json_extract(v.value, '$[0]') END END AS x,
        CASE WHEN v.type = 'array' THEN CASE WHEN json_array_length(v.value) = 2
          AND json_type(v.value, '$[0]') IN ('integer', 'real') AND json_type(v.value, '$[1]') IN ('integer', 'real')
          THEN json_extract(v.value, '$[1]') END END AS y
      FROM operating_areas a, json_each(a.polygon) r, json_each(CASE WHEN r.type = 'array' THEN
        CASE WHEN json_array_length(r.value) >= 3 THEN r.value ELSE '[null]' END ELSE '[null]' END) v
    ), pin_edges AS (
      SELECT area_id, ring, x, y,
        coalesce(lead(x) OVER points, first_value(x) OVER points) AS next_x,
        coalesce(lead(y) OVER points, first_value(y) OVER points) AS next_y
      FROM pin_vertices WINDOW points AS (PARTITION BY area_id, ring ORDER BY vertex)
    ), pin_ring_tests AS (
      SELECT e.area_id, e.ring,
        min(coalesce(e.x BETWEEN -180 AND 180 AND e.y BETWEEN -90 AND 90, 0))
          AND abs(sum(e.x * e.next_y - e.next_x * e.y)) > 0 AS valid,
        max((e.next_x <> e.x OR e.next_y <> e.y)
          AND p.x BETWEEN min(e.x, e.next_x) AND max(e.x, e.next_x)
          AND p.y BETWEEN min(e.y, e.next_y) AND max(e.y, e.next_y)
          AND abs((p.x - e.x) * (e.next_y - e.y) - (p.y - e.y) * (e.next_x - e.x)) <= 1e-12)
        OR sum(CASE WHEN (e.y > p.y) <> (e.next_y > p.y)
          AND p.x < e.x + 1.0 * (p.y - e.y) * (e.next_x - e.x) / (e.next_y - e.y) THEN 1 ELSE 0 END) % 2 = 1 AS contains_pin
      FROM pin_edges e CROSS JOIN pin_input p GROUP BY e.area_id, e.ring
    ), pin_coverage AS MATERIALIZED (
      SELECT a.id, a.site_zone FROM pin_ring_tests t JOIN operating_areas a ON a.id = t.area_id
      GROUP BY a.id HAVING min(t.valid) = 1 AND max(CASE WHEN t.ring = 0 THEN t.contains_pin ELSE 0 END) = 1
        AND max(CASE WHEN t.ring <> 0 THEN t.contains_pin ELSE 0 END) = 0
    ), pin_area AS MATERIALIZED (
      SELECT id, site_zone FROM pin_coverage WHERE (SELECT count(*) FROM pin_coverage) = 1
    )` };
}
