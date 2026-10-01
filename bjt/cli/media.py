"""Audio and pictures: `synth` (bjt/tts/synth.py), `audition`, `scenes`
(bjt/scenes.py, bjt/scene_art.py) and `render` (a document to HTML)."""
from __future__ import annotations

import pathlib
import sys

from .. import batch as batchmod
from .. import (
    config,
    fixtures,
    pipeline,
    render,
    schemas,
    scenes as scenemod,
    withdrawn,
)
from ..files import write_atomic
from ..generators import GENERATORS


def cmd_synth(args) -> int:
    """Bundle → audio files + the SQL that points the database at them.

    Producing files and producing SQL are the job. Uploading is opt-in
    (`--upload`) and applying the SQL stays a separate act, so on a laptop no
    key that can write media has to exist, and in the deploy workflow — the
    one place all three happen together — each step is still its own line.
    """
    from .. import scene_art
    from ..tts import providers, synth

    path = pathlib.Path(args.path)
    bundle = batchmod.load(path)
    report = batchmod.check_bundle(bundle)
    if not report.ok and not args.force:
        pipeline.print_bundle_report(bundle, report)
        print("\nRefusing to synthesise audio for a bundle that fails its own checks.",
              file=sys.stderr)
        print("A clip is expensive and permanent; an item that has not cleared its "
              "gates has no business having a voice recorded for it.", file=sys.stderr)
        return 1

    try:
        provider = providers.get_provider(args.provider)
    except KeyError as exc:
        print(exc.args[0], file=sys.stderr)
        return 2

    bucket = None
    if args.upload:
        if provider.name == "silent":
            print("--upload with the silent provider would ship silence: a learner would "
                  "hear nothing where the app now shows the text. Refusing.", file=sys.stderr)
            return 2
        if not args.have:
            # Without the database's list of live clips, an empty media/ makes
            # every clip look new: all of them re-synthesised, and each one's
            # duration rewritten from a recording nobody hears.
            print("--upload needs --have: the clip ids already live, one per line, read "
                  "out of the database (an empty file on a fresh project). A live clip is "
                  "never re-made.", file=sys.stderr)
            return 2
        bucket = scene_art.Bucket(name="audio")
        if not bucket.configured:
            print("--upload needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in the environment",
                  file=sys.stderr)
            return 2

    have = synth.read_have(pathlib.Path(args.have)) if args.have else None
    remake = synth.read_have(pathlib.Path(args.remake)) if args.remake else None
    if remake:
        print(f"Re-making {len(remake)} named clip(s) if this bundle asks for them — "
              "the recording a learner already heard is being replaced.")

    run = synth.run(bundle, provider=provider, bucket=bucket, media_dir=args.media_dir,
                    force=args.force_clips, limit=args.limit, have=have, remake=remake)
    result, up = run.report, run.uploaded
    if run.skipped:
        print(f"Skipping {run.skipped} clip(s) only withdrawn items use "
              f"(batches/{withdrawn.LEDGER_NAME}).")

    print(result.summary())
    for clip_id, error in result.failed:
        print(f"  FAILED {clip_id}: {error}", file=sys.stderr)

    if provider.name == "silent":
        print()
        print("  These are SILENT placeholder clips. They exercise the pipeline — "
              "planning,\n  channel treatment, durations, the SQL — and prove nothing "
              "about how the\n  Japanese sounds. Their storage path says `silent/` so "
              "they can never be\n  mistaken for real recordings. Set GEMINI_API_KEY or "
              "OPENAI_API_KEY for\n  real voices; `bjt audition` compares them.")

    if bucket is not None and up is not None:
        print(f"uploaded {len(up.sent)} clip(s) to the `{bucket.name}` bucket")
        if up.existing:
            print(f"{len(up.existing)} clip(s) were already in the bucket; left alone and "
                  "counted as live")
        for clip_path, why in up.failed:
            print(f"not uploaded: {clip_path}: {why}", file=sys.stderr)

    if not result.clips and not result.live:
        return 0

    out = pathlib.Path(args.out) if args.out else path.with_name(
        path.stem + ".audio.sql"
    )
    write_atomic(out, synth.to_sql(result))
    print(f"\nWrote {out}")

    record = (args.media_dir or config.MEDIA_DIR) / "reports" / f"{path.stem}.json"
    synth.write_report(result, pathlib.Path(record))
    print(f"Wrote {record}")

    if result.clips:
        print()
        if bucket is None:
            print("Next: upload media/audio/** to the `audio` bucket (or re-run with "
                  "--upload), then apply the SQL:")
        else:
            print("Next: apply the SQL:")
        print(f"  (cd client && npx wrangler d1 execute business-japanese-drill --remote --file {out.resolve()})")
    return 1 if result.failed else 0


def cmd_audition(args) -> int:
    """The same lines, every cast voice, every configured provider — for a
    person to listen to before the library is synthesised."""
    from ..tts import audition, providers

    names = args.provider if args.provider else providers.available()
    if not names and not args.voices:
        print("No TTS provider is configured. Set one of:", file=sys.stderr)
        for name, keys in providers.CREDENTIALS.items():
            print(f"  {name:8} {' or '.join(keys)}", file=sys.stderr)
        print("(`--provider silent` exercises the page with silent clips.)", file=sys.stderr)
        return 2
    unknown = sorted(set(names) - set(providers.PROVIDERS))
    if unknown:
        print(f"unknown provider(s): {', '.join(unknown)}; "
              f"available: {sorted(providers.PROVIDERS)}", file=sys.stderr)
        return 2

    report = audition.run(names, media_dir=args.media_dir, force=args.force,
                          voices=args.voices)
    print(report.summary())
    for name, voice, why in report.failed:
        print(f"  FAILED {name} {voice}: {why}", file=sys.stderr)
    print(f"\nOpen {report.root / 'index.html'} and listen.")
    if args.voices:
        print(f"Every {providers.DEFAULT} voice saying one line is under "
              f"{report.root / 'openai-voices'}; a recast goes in OpenAIProvider.VOICE_IDS.")
    return 1 if report.failed else 0


def cmd_scenes(args) -> int:
    """What the scene bank needs, what exists, the drawing of what is missing,
    and the SQL for what is approved."""
    from .. import scene_art

    # The bucket is consulted whenever it is configured: on the nightly runner
    # media/ is empty every night, and the only record of what has already
    # been drawn is the bucket itself.
    bucket = scene_art.Bucket()
    remote: set[str] = set()
    if bucket.configured and (args.generate is not None or args.upload or args.sql):
        try:
            remote = bucket.list()
        except RuntimeError as exc:
            print(f"could not list the scenes bucket: {exc}", file=sys.stderr)
            return 1
    elif args.upload:
        print("--upload needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in the environment",
              file=sys.stderr)
        return 2

    survey = scenemod.survey(args.media_dir, remote)

    if args.prompt:
        wanted = [s for s in survey if s.scene_id == args.prompt]
        if not wanted:
            print(f"no scene {args.prompt!r} in any committed seed table", file=sys.stderr)
            return 2
        print(scenemod.prompt_for(wanted[0]))
        return 0

    failed = False
    if args.generate is not None:
        try:
            provider = scene_art.get_provider(args.provider)
        except KeyError as exc:
            print(exc.args[0], file=sys.stderr)
            return 2
        try:
            wanted = scene_art.select(survey, args.generate, force=args.force, only=args.only)
        except ValueError as exc:
            print(exc, file=sys.stderr)
            return 2
        prior, on_reject, warning = scene_art.lifetime_ledger(bucket, record=args.upload)
        if warning:
            print(warning, file=sys.stderr)
        if not wanted:
            note = "every scene already has artwork; nothing to draw (--force redraws)"
            print(note)
            # The summary file is a promise to the workflow, which appends it to
            # the run page whatever happened. A night with nothing to draw is
            # the ordinary night once the bank is full, and it must not be the
            # night the job fails on a missing file.
            if args.summary:
                pathlib.Path(args.summary).write_text(
                    f"## Scene artwork ({provider.name})\n\n{note}\n", encoding="utf-8")
        else:
            try:
                result = scene_art.draw(
                    wanted, provider=provider, review=scene_art.review_with_model,
                    media_dir=args.media_dir, attempts=args.attempts,
                    prior=prior, on_reject=on_reject,
                )
            except scene_art.DrawStopped as stop:
                # The ceiling: nothing more is drawn, and what was approved
                # before it is still uploaded and pointed at below.
                print(f"stopping the drawing: {stop}", file=sys.stderr)
                result = stop.result
            print(result.summary())
            if args.summary:
                pathlib.Path(args.summary).write_text(result.summary() + "\n", encoding="utf-8")
            failed = bool(result.failed) or result.stopped is not None
            if not provider.real:
                print("\n  placeholder provider: files are under media/scenes/placeholder/,")
                print("  the survey does not count them, and nothing uploads them.")
            survey = scenemod.survey(args.media_dir, remote)

    if args.upload:
        up = scene_art.upload_approved(survey, bucket, args.media_dir)
        print(f"uploaded {len(up.sent)} file(s) to the `{bucket.name}` bucket"
              + (": " + ", ".join(up.sent) if up.sent else ""))
        for path, why in up.failed:
            print(f"not uploaded: {path}: {why}", file=sys.stderr)
        if up.failed:
            failed = True
            if args.summary:
                with pathlib.Path(args.summary).open("a", encoding="utf-8") as fh:
                    fh.write("\n" + up.summary() + "\n")
            # The SQL below must describe the bucket, not this machine.
            survey = scene_art.without(survey, up.failed_paths)

    have = [s for s in survey if s.has_art]

    if args.sql:
        out = pathlib.Path(args.out) if args.out else config.ROOT / "batches" / "scenes.sql"
        write_atomic(out, scenemod.to_sql(survey))
        stand_ins = [(s, scenemod.stand_in_for(s, survey)) for s in survey]
        borrowed = [(s, o) for s, o in stand_ins if o is not None]
        print(f"Wrote {out}  ({len(have)} scene(s) with artwork"
              + (f", {len(borrowed)} on a stand-in" if borrowed else "") + ")")
        if args.summary and borrowed:
            with pathlib.Path(args.summary).open("a", encoding="utf-8") as fh:
                fh.write("\n### Stand-ins\n\n")
                for s, o in borrowed:
                    fh.write(f"- `{s.scene_id}` shows `{o.scene_id}`'s picture until its own is drawn.\n")
        return 1 if failed else 0

    if args.generate is not None or args.upload:
        return 1 if failed else 0

    print(f"scene bank: {len(survey)} scene(s), {len(have)} with artwork\n")
    print(f"  {'scene_id':32} {'art':4} {'cells':>6}  used by")
    for scene in survey:
        other = scenemod.stand_in_for(scene, survey)
        mark = "yes" if scene.has_art else ("↪" if other else "—")
        print(f"  {scene.scene_id:32} {mark:4} {scene.cell_count:6}  "
              f"{'、'.join(scene.used_by)}"
              + (f"  (shows {other.scene_id})" if other else "")
              + ("  [per-item picture]" if scene.is_picture else ""))
    if not have:
        print("\n  No artwork yet. Items ship and are practised without pictures —")
        print("  except 画像把握, whose items wait for their own picture.")
        print("  `bjt scenes --generate` draws the missing ones and reviews each draft;")
        print("  `bjt scenes --prompt <scene_id>` prints the brief for one.")
    return 0


def cmd_render(args) -> int:
    """Render a document stimulus to HTML, to look at while writing one."""
    item = None
    if getattr(args, "chart", False):
        # The worked example of a document with a graph in it, which no type's
        # own fixture carries: a 資料聴読解 item on the `figures` template.
        item = fixtures.CHART_FIXTURE
    elif args.item_type:
        item = fixtures.FIXTURES.get(args.item_type)
        if item is None:
            print(f"no fixture for {args.item_type!r}", file=sys.stderr)
            return 2
    else:
        bundle = batchmod.load(pathlib.Path(args.path))
        items = [i for i in bundle["items"] if i.get("documents")]
        if not items:
            print("no document items in that bundle", file=sys.stderr)
            return 2
        item = items[min(args.index, len(items) - 1)]

    field = schemas.DOCUMENT_FIELDS.get(item.get("item_type", ""))
    raw = item.get("documents") or ([item.get(field)] if field else [])
    docs = [d for d in (raw if isinstance(raw, list) else [raw]) if isinstance(d, dict)]
    if not docs:
        print("that item has no document", file=sys.stderr)
        return 2

    html = "\n".join(render.render_page(d) if args.page else render.render(d) for d in docs)
    if args.out:
        pathlib.Path(args.out).write_text(html, encoding="utf-8")
        print(f"Wrote {args.out}")
    else:
        print(html)
    return 0



def register(sub, types: list[str]) -> None:
    """Add this module's subcommands to the `bjt` parser."""
    sy = sub.add_parser("synth", help="synthesise a bundle's audio and write the SQL for it")
    sy.add_argument("path", help="path to a checked bundle .json")
    sy.add_argument("--provider", default="auto",
                    help="TTS backend: auto (BJT_TTS_PROVIDER, else the library's voice "
                         "when its key is set, else silent), or a provider by name; "
                         "silent is an offline placeholder")
    sy.add_argument("--have", metavar="FILE",
                    help="clip ids already live (one per line): skipped entirely. "
                         "The deploy workflow reads them out of the database")
    sy.add_argument("--remake", metavar="FILE",
                    help="clip ids (one per line) to synthesise again even though they "
                         "are live: for replacing clips made with the wrong delivery. "
                         "Named clips only — never a blanket re-make of the library")
    sy.add_argument("--upload", action="store_true",
                    help="put the clips in the `audio` bucket "
                         "(needs --have and the R2_* credentials); never over "
                         "a file already there but the ones --remake names")
    sy.add_argument("--out", help="where to write the SQL (default: alongside the bundle)")
    sy.add_argument("--media-dir", type=pathlib.Path,
                    help=f"where audio files go (default: {config.MEDIA_DIR})")
    sy.add_argument("--limit", type=int,
                    help="cap how many NEW clips this run may make — a budget, not a "
                         "debugging convenience")
    sy.add_argument("--force-clips", action="store_true",
                    help="re-synthesise clips that already exist on disk")
    sy.add_argument("--force", action="store_true",
                    help="synthesise even if the bundle fails its checks")
    sy.set_defaults(func=cmd_synth)
    au = sub.add_parser("audition", help="the same lines in every cast voice from each "
                                         "configured TTS provider, for a person to compare")
    au.add_argument("--provider", nargs="*", metavar="NAME",
                    help="which providers (default: every one with credentials)")
    au.add_argument("--media-dir", type=pathlib.Path,
                    help=f"where the clips go (default: {config.MEDIA_DIR}/audition)")
    au.add_argument("--voices", action="store_true",
                    help="also one line in every voice the library's provider offers, "
                         "to recast a role by ear")
    au.add_argument("--force", action="store_true", help="re-synthesise clips that exist")
    au.set_defaults(func=cmd_audition)
    sc = sub.add_parser("scenes", help="what the scene bank needs, draw what is missing")
    sc.add_argument("--media-dir", type=pathlib.Path,
                    help=f"where scene art lives (default: {config.MEDIA_DIR}/scenes)")
    sc.add_argument("--prompt", metavar="SCENE_ID",
                    help="print the illustration brief for one scene")
    sc.add_argument("--generate", nargs="*", metavar="SCENE_ID",
                    help="draw the scenes that have no artwork (or only the named ones), "
                         "reviewing every draft against the brief")
    sc.add_argument("--provider", default="openai",
                    help="image backend: openai (needs OPENAI_API_KEY), or placeholder "
                         "(offline, grey rectangles that are never counted as art)")
    sc.add_argument("--attempts", type=int, default=None,
                    help=f"drafts the review may reject per scene (default: {config.SCENE_ATTEMPTS})")
    sc.add_argument("--force", action="store_true",
                    help="redraw even scenes that already have artwork")
    sc.add_argument("--only", choices=["bank", "pictures"], default=None,
                    help="draw only the shared bank, or only the per-item pictures "
                         "(default: both)")
    sc.add_argument("--upload", action="store_true",
                    help="put approved files in the `scenes` bucket "
                         "(needs the R2_* credentials)")
    sc.add_argument("--sql", action="store_true",
                    help="write the SQL pointing the database at approved artwork")
    sc.add_argument("--out", help="where to write that SQL")
    sc.add_argument("--summary", default=None, help="write a markdown summary here")
    sc.set_defaults(func=cmd_scenes)
    rn = sub.add_parser("render", help="render a document stimulus to HTML")
    rn.add_argument("path", nargs="?", help="a bundle .json containing document items")
    rn.add_argument("--item-type", choices=sorted(GENERATORS),
                    help="render this type's fixture instead of a bundle item")
    rn.add_argument("--chart", action="store_true",
                    help="render the worked example of a document carrying a graph")
    rn.add_argument("--index", type=int, default=0, help="which document item in the bundle")
    rn.add_argument("--page", action="store_true",
                    help="a standalone HTML page rather than a fragment")
    rn.add_argument("--out", help="write to a file instead of stdout")
    rn.set_defaults(func=cmd_render)
