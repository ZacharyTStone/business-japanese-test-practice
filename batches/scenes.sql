-- Artwork for 19 scene(s).
-- Produced by bjt scenes --sql. Idempotent: re-running sets the same values.
-- For D1: wrangler d1 execute applies the file all or nothing.

insert into scenes (id, label_ja, image_path) values ('pic_09fa4bde9a', '取引先の会議室で名刺交換をする', 'pic_09fa4bde9a.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('pic_2b3e3869ff', 'オフィス移転に伴う什器の運搬', 'pic_2b3e3869ff.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('pic_643098801f', '社内書類への押印', 'pic_643098801f.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('scene_client_meeting_room', '取引先の会議室', 'scene_client_meeting_room.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('scene_client_office_sofa', '取引先の応接ソファ', 'scene_client_office_sofa.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('scene_corridor', 'オフィスの廊下', 'scene_corridor.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('scene_elevator_hall', 'エレベーターホール', 'scene_elevator_hall.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('scene_entrance_lobby', 'エントランスロビー', 'scene_entrance_lobby.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('scene_expo_booth', '展示会のブース', 'scene_expo_booth.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('scene_izakaya_table', '居酒屋のテーブル', 'scene_izakaya_table.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('scene_meeting_room_table', '社内の会議室のテーブル', 'scene_meeting_room_table.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('scene_office_desk_pair', '自分の席で向かい合う二人', 'scene_office_desk_pair.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('scene_office_open_floor', '執務フロア全体', 'scene_office_open_floor.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('scene_phone_desk', 'デスクで固定電話', 'scene_phone_desk.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('scene_phone_mobile_outside', '外出先で携帯電話', 'scene_phone_mobile_outside.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('scene_reception_counter', '自社の受付カウンター', 'scene_reception_counter.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('scene_restaurant_private', '料理店の個室', 'scene_restaurant_private.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('scene_seminar_hall', 'セミナー会場', 'scene_seminar_hall.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
insert into scenes (id, label_ja, image_path) values ('scene_video_call_laptop', 'ノートPCでオンライン会議', 'scene_video_call_laptop.webp') on conflict (id) do update set label_ja = excluded.label_ja, image_path = excluded.image_path;
