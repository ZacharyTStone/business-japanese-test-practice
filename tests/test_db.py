"""SQLite persistence: items, responses, metrics history."""
from bjt import schemas


def test_insert_and_get(store, goi_item):
    iid = store.insert_item("goi_bunpou", "J2", goi_item, "test-model")
    got = store.get_item(iid)
    assert got["stem"] == goi_item["stem"]
    assert len(got["options"]) == 4
    assert got["correct_index"] == schemas.correct_index(goi_item["options"])


def test_response_accuracy(store, goi_item, hyougen_item):
    g = store.insert_item("goi_bunpou", "J2", goi_item, "m")
    h = store.insert_item("hyougen", "J2", hyougen_item, "m")
    store.record_response(g, 0, True)
    store.record_response(g, 1, False)
    store.record_response(h, 0, True)

    acc = {r["item_type"]: r for r in store.accuracy_by_type()}
    assert acc["goi_bunpou"]["answered"] == 2
    assert acc["goi_bunpou"]["correct"] == 1
    assert acc["goi_bunpou"]["accuracy"] == 0.5
    assert acc["hyougen"]["accuracy"] == 1.0


def test_recent_topics_dedup_window(store, goi_item):
    for i in range(5):
        item = dict(goi_item)
        item["topic"] = f"topic-{i}"
        store.insert_item("goi_bunpou", "J2", item, "m")
    topics = store.recent_topics("goi_bunpou", 3)
    assert topics == ["topic-4", "topic-3", "topic-2"]  # newest first


def test_kept_items_excludes_discarded(store, goi_item):
    store.insert_item("goi_bunpou", "J2", goi_item, "m", gate_verdict="kept")
    store.insert_item("goi_bunpou", "J2", goi_item, "m", gate_verdict="skipped")
    store.insert_item("goi_bunpou", "J2", goi_item, "m", gate_verdict="discarded:leaky")
    kept = store.kept_items("goi_bunpou", 10)
    assert len(kept) == 2
    assert all(k["gate_verdict"] in ("kept", "skipped") for k in kept)


def test_gate_summary(store, goi_item):
    store.insert_item("goi_bunpou", "J2", goi_item, "m",
                      cold_success_rate=0.0, full_success_rate=1.0, gate_verdict="kept")
    store.insert_item("goi_bunpou", "J2", goi_item, "m",
                      cold_success_rate=0.33, full_success_rate=1.0, gate_verdict="kept")
    gs = {r["item_type"]: r for r in store.gate_summary()}
    assert gs["goi_bunpou"]["n"] == 2
    assert abs(gs["goi_bunpou"]["avg_full"] - 1.0) < 1e-9


def test_verdict_counts(store, goi_item):
    store.insert_item("goi_bunpou", "J2", goi_item, "m", gate_verdict="kept")
    store.insert_item("goi_bunpou", "J2", goi_item, "m", gate_verdict="discarded:leaky")
    store.insert_item("goi_bunpou", "J2", goi_item, "m", gate_verdict="discarded:leaky")
    counts = {r["gate_verdict"]: r["n"] for r in store.verdict_counts()}
    assert counts["kept"] == 1
    assert counts["discarded:leaky"] == 2


def test_discriminator_run_roundtrip(store):
    store.insert_discriminator_run("goi_bunpou", 5, 5, 0.6, ["tell A", "tell B"])
    latest = store.latest_discriminator_runs()
    assert len(latest) == 1
    assert latest[0]["discrimination_rate"] == 0.6
    assert latest[0]["reasons"] == ["tell A", "tell B"]


def test_calibration_run_roundtrip(store):
    rid = store.insert_calibration_run("hyougen", 0.7, 0.9, 10, 20)
    assert isinstance(rid, int)
