-- Artwork for 21 scene(s).
-- Produced by `bjt scenes --sql`. Idempotent: re-running sets the same values.

begin;

insert into public.scenes (id, label_ja, image_path)
values ('pic_09fa4bde9a', '取引先の会議室で名刺交換をする', 'pic_09fa4bde9a.webp'),
       ('pic_1a8cd70899', '席にいる同僚に書類を渡す', 'pic_1a8cd70899.webp'),
       ('pic_2cf468fc3d', 'セミナー会場でメモを取る', 'pic_2cf468fc3d.webp'),
       ('pic_66f0315028', '会議室でホワイトボードを使って説明する', 'pic_66f0315028.webp'),
       ('pic_917fb25e9a', '受付で来客を奥へ案内する', 'pic_917fb25e9a.webp'),
       ('scene_client_meeting_room', '取引先の会議室', 'scene_client_meeting_room.webp'),
       ('scene_client_office_sofa', '取引先の応接ソファ', 'scene_client_office_sofa.webp'),
       ('scene_corridor', 'オフィスの廊下', 'scene_corridor.webp'),
       ('scene_elevator_hall', 'エレベーターホール', 'scene_elevator_hall.webp'),
       ('scene_entrance_lobby', 'エントランスロビー', 'scene_entrance_lobby.webp'),
       ('scene_expo_booth', '展示会のブース', 'scene_expo_booth.webp'),
       ('scene_izakaya_table', '居酒屋のテーブル', 'scene_izakaya_table.webp'),
       ('scene_meeting_room_table', '社内の会議室のテーブル', 'scene_meeting_room_table.webp'),
       ('scene_office_desk_pair', '自分の席で向かい合う二人', 'scene_office_desk_pair.webp'),
       ('scene_office_open_floor', '執務フロア全体', 'scene_office_open_floor.webp'),
       ('scene_phone_desk', 'デスクで固定電話', 'scene_phone_desk.webp'),
       ('scene_phone_mobile_outside', '外出先で携帯電話', 'scene_phone_mobile_outside.webp'),
       ('scene_reception_counter', '自社の受付カウンター', 'scene_reception_counter.webp'),
       ('scene_restaurant_private', '料理店の個室', 'scene_restaurant_private.webp'),
       ('scene_seminar_hall', 'セミナー会場', 'scene_seminar_hall.webp'),
       ('scene_video_call_laptop', 'ノートPCでオンライン会議', 'scene_video_call_laptop.webp')
on conflict (id) do update set
       label_ja   = excluded.label_ja,
       image_path = excluded.image_path;

commit;
