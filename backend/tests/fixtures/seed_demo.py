"""Seed a throwaway Vulpexa database with demo and worst-case data.

Used by the end-to-end tests and for screenshots: ten agent devices with
long names, umlauts and an emoji, one phone without agent, open, acknowledged
and resolved alerts, scripts with finished, failed and running jobs, and 48 h
of metrics. ``--many N`` adds N generic devices for load tests.

Usage (from backend/): python tests/fixtures/seed_demo.py <new.db> [--many N]

Refuses to touch an existing file: this writes fixed demo passwords and must
never land in a real database.
"""

from __future__ import annotations

import asyncio
import random
import sys
import time
from pathlib import Path

from app import (
    accounts,
    alerts,
    audit,
    automation,
    credentials,
    devices,
    jobs,
    metrics,
    patches,
    persons,
    scripts,
)
from app.config import Settings
from app.db import connect

# Demo data, not secrets: a fixed seed keeps screenshots comparable.
rng = random.Random(7)  # noqa: S311 - generates demo values, nothing security-relevant
DEMO_PASSWORD = "demo-passwort-123"
NOW = int(time.time())

FLEET = [
    # hostname, os, os_version, arch, owner, tags, cpu, mem, disk, online, extras
    (
        "buero-pc-01",
        "windows",
        "Windows 11 Pro 24H2 (26100.4061)",
        "amd64",
        "Robin",
        ["büro", "win"],
        12,
        48,
        61,
        True,
        {"logged_in_user": "robin", "cpu_temp_c": 48},
    ),
    (
        "nas-keller",
        "linux",
        "Debian GNU/Linux 12 (bookworm)",
        "amd64",
        "",
        ["server", "storage"],
        4,
        31,
        93,
        True,
        {"reboot_required": True},
    ),
    (
        "macbook-anna",
        "darwin",
        "macOS 15.4 Sequoia",
        "arm64",
        "Anna",
        ["laptop"],
        22,
        71,
        54,
        True,
        {"battery_pct": 38, "battery_state": "discharging", "logged_in_user": "anna"},
    ),
    (
        "omas-laptop",
        "windows",
        "Windows 10 Home 22H2",
        "amd64",
        "Oma Gisela",
        ["familie"],
        0,
        0,
        0,
        False,
        {},
    ),
    (
        "pve-host",
        "linux",
        "Proxmox VE 8.3 (Debian 12)",
        "amd64",
        "",
        ["server", "kritisch"],
        63,
        82,
        71,
        True,
        {"cpu_temp_c": 71},
    ),
    (
        "küchen-tablet-ü",
        "linux",
        "Ubuntu 24.04.2 LTS",
        "arm64",
        "Jörg Müßiggang",
        ["familie", "küche"],
        3,
        22,
        40,
        True,
        {},
    ),
    (
        "srv-backup-offsite-hetzner-fsn1-dc14-storagebox-replica-0001",
        "linux",
        "Ubuntu 22.04.5 LTS",
        "amd64",
        "Hosting 🚀",
        ["server", "offsite", "backup", "hetzner", "replica"],
        1,
        12,
        88,
        True,
        {},
    ),
    (
        "gaming-rig",
        "windows",
        "Windows 11 Pro 23H2",
        "amd64",
        "Ben",
        ["privat"],
        97,
        91,
        76,
        True,
        {"cpu_temp_c": 89},
    ),
    ("raspi-pihole", "linux", "Raspbian 12", "arm64", "", ["netz"], 2, 18, 24, False, {}),
    (
        "WIN-7Q3K2M9LP0X",
        "windows",
        "Windows Server 2022 Standard",
        "amd64",
        "",
        [],
        35,
        64,
        99,
        True,
        {"reboot_required": True},
    ),
]

PATCH_TITLES = [
    (
        "KB5055523",
        "2026-10 Kumulatives Update für Windows 11 Version 24H2 für x64-basierte Systeme",
        "critical",
    ),
    ("KB5056579", ".NET Framework 3.5 und 4.8.1 Sicherheitsupdate", "important"),
    ("openssl", "openssl 3.0.15-1~deb12u1 → 3.0.16-1~deb12u1", "important"),
    ("linux-image-amd64", "linux-image-amd64 6.1.128-1 → 6.1.133-1", "moderate"),
    ("firefox", "Mozilla Firefox 131.0 → 131.0.3", "low"),
    (
        "defender",
        "Security Intelligence-Update für Microsoft Defender Antivirus – KB2267602 (Version 1.421.1234.0)",
        "other",
    ),
]


async def main(db_path: str, many: int) -> None:
    s = Settings(_env_file=None, app_env="development", storage_db_path=db_path, bootstrap_admin_password="")
    for mod in (
        accounts,
        devices,
        metrics,
        alerts,
        audit,
        jobs,
        scripts,
        patches,
        automation,
        persons,
        credentials,
    ):
        await mod.ensure_schema(s)

    if not await accounts.count_users():
        await accounts.create_user("admin", DEMO_PASSWORD, role="admin")
    p1 = await persons.create_person("Anna Beispiel", "anna@example.org", "+49 151 0000000")
    p2 = await persons.create_person(
        "Gisela Großmutter-Überlänge von und zu Hohenzollern-Sigmaringen", "", ""
    )
    await accounts.create_user("viewer", DEMO_PASSWORD, role="viewer")
    await accounts.create_user("techniker", DEMO_PASSWORD, role="techniker")

    ids: list[int] = []
    fleet = list(FLEET)
    for i in range(many):
        os_ = rng.choice(["windows", "linux", "darwin"])
        fleet.append(
            (
                f"host-{i:05d}",
                os_,
                "Generic 1.0",
                "amd64",
                "",
                ["bulk"],
                rng.randint(0, 100),
                rng.randint(5, 95),
                rng.randint(5, 99),
                rng.random() > 0.15,
                {},
            )
        )

    for host, os_, osv, arch, owner, tags, cpu, mem, disk, online, extras in fleet:
        tok, _ = await devices.create_enrollment_token("seed", 1)
        dev = await devices.enroll_device(
            token=tok,
            hostname=host,
            owner_label=owner,
            os=os_,
            os_version=osv,
            arch=arch,
            agent_version="1.8.2",
        )
        did = dev["device_id"]
        ids.append(did)
        hb = {
            "agent_version": "1.8.2" if host != "omas-laptop" else "1.6.0",
            "hostname": host,
            "cpu_pct": cpu,
            "mem_pct": mem,
            "mem_used_b": int(mem / 100 * 16 * 2**30),
            "mem_total_b": 16 * 2**30,
            "disks": [
                {
                    "mount": "C:\\" if os_ == "windows" else "/",
                    "used_pct": disk,
                    "used_b": int(disk / 100 * 512e9),
                    "total_b": int(512e9),
                }
            ],
            "net_rx_bps": rng.randint(0, 12_000_000),
            "net_tx_bps": rng.randint(0, 2_000_000),
            **extras,
        }
        if host == "nas-keller":
            hb["disks"].append(
                {
                    "mount": "/srv/daten-mit-sehr-langem-mountpoint/archiv",
                    "used_pct": 97,
                    "used_b": int(15.5e12),
                    "total_b": int(16e12),
                }
            )
        if cpu or mem:
            await devices.record_heartbeat(did, hb)
        await devices.update_device(
            did,
            tags=tags,
            person_id=p1["id"] if owner == "Anna" else (p2["id"] if owner.startswith("Oma") else None),
        )
        await devices.set_inventory(
            did,
            "hardware",
            {
                "manufacturer": "LENOVO" if os_ == "windows" else "",
                "model": "ThinkCentre M75q Gen 2",
                "serial": "PF2X9ABC",
                "platform": os_,
                "platform_version": osv,
                "kernel_version": "6.1.0-28-amd64",
                "cpu_model": "AMD Ryzen 5 PRO 4650GE with Radeon Graphics",
                "cpu_threads": 12,
                "mem_total_b": 16 * 2**30,
                "uptime_s": rng.randint(3600, 90 * 86400),
                "nics": [
                    {
                        "name": "eth0",
                        "mac": "00:11:22:33:44:55",
                        "ips": ["192.168.2.40", "fe80::211:22ff:fe33:4455"],
                    }
                ],
                "gateway": "192.168.2.1",
                "dns": ["192.168.2.1"],
            },
        )
        await devices.set_inventory(
            did, "software", [{"name": f"Paket {n}", "version": f"1.{n}.0"} for n in range(40)]
        )
        async with connect(db_path) as db:
            last_seen = NOW - 30 if online else NOW - rng.choice([3 * 3600, 6 * 86400])
            if not (cpu or mem) and not online:
                last_seen = NOW - 23 * 86400
            await db.execute(
                "UPDATE devices SET last_seen_at = ?, created_at = ? WHERE id = ?",
                (last_seen, NOW - 120 * 86400, did),
            )
            # 48 h of raw metrics, 5-min steps, plausible drift around the current value
            rows = []
            c, m = float(cpu), float(mem)
            for k in range(48 * 12, 0, -1):
                c = min(100, max(0, c + rng.uniform(-6, 6)))
                m = min(100, max(0, m + rng.uniform(-1.5, 1.5)))
                rows.append((did, NOW - k * 300, c, m, float(disk)))
            if online and did <= len(FLEET):
                await db.executemany(
                    "INSERT INTO metrics (device_id, ts, cpu_pct, mem_pct, disk_max_pct)"
                    " VALUES (?, ?, ?, ?, ?)",
                    rows,
                )
            await db.commit()
        if os_ != "darwin" and did <= len(FLEET):
            await patches.apply_scan(
                did,
                [
                    {"patch_id": pid, "title": t, "severity": sev}
                    for pid, t, sev in rng.sample(PATCH_TITLES, k=rng.randint(0, 5))
                ],
            )
            await devices.mark_patch_scan(did, NOW - rng.randint(600, 30 * 3600))

    # Mobile device (no agent)
    await devices.create_manual_device(
        hostname="iPhone von Anna",
        os="ios",
        os_version="18.4",
        ownership="private",
        model="iPhone 15",
        serial="F2LXYZ",
        imei="35 209900 176148 1",
        notes="",
        owner_label="Anna",
        tags=["mobil"],
        person_id=p1["id"],
    )

    # Alerts: some open, some acked, some resolved
    await alerts._fire(
        ids[1], "disk", "Datenträger /srv/daten-mit-sehr-langem-mountpoint/archiv zu 97 % belegt"
    )
    await alerts._fire(ids[3], "offline", "omas-laptop seit 23 Tagen offline")
    await alerts._fire(ids[9], "disk", "Datenträger C:\\ zu 99 % belegt")
    a4 = await alerts._fire(ids[6], "disk", "Datenträger / zu 88 % belegt")
    await alerts._fire(ids[8], "offline", "raspi-pihole seit 3 Stunden offline")
    await alerts.ack(a4, "admin")

    # Scripts + jobs
    sc = await scripts.create(
        "Datenträger bereinigen",
        "powershell",
        "Cleanmgr /sagerun:1",
        "admin",
        os="windows",
        category="wartung",
    )
    await scripts.create(
        "Dienststatus prüfen (systemctl --failed) inkl. Journal der letzten 24 Stunden",
        "bash",
        "systemctl --failed\njournalctl -p err --since -24h | tail -50",
        "admin",
        os="linux",
        category="diagnose",
    )
    await scripts.create(
        "Neustart erzwingen",
        "powershell",
        "Restart-Computer -Force",
        "admin",
        os="windows",
        category="wartung",
        danger=True,
    )
    for did, status, code, out in [
        (ids[0], "done", 0, "Bereinigung abgeschlossen. 4,2 GB freigegeben.\n"),
        (
            ids[1],
            "failed",
            1,
            "Job for smbd.service failed because the control process exited with error code.\n",
        ),
        (ids[4], "running", None, "Downloading updates… 42%\n"),
        (ids[7], "timeout", None, ""),
    ]:
        j = await jobs.create_job(
            did, kind="script", script_id=sc["id"], script_name=sc["name"], created_by="admin"
        )
        await jobs.mark_running(j["id"])
        if out:
            await jobs.append_output(j["id"], out)
        if status != "running":
            await jobs.finish_job(j["id"], status, code)
        await audit.record("job.created", user="admin", device_id=did, job_id=j["id"], script_id=sc["id"])

    await audit.record("auth.login", user="admin", ip="192.168.2.10")
    await audit.record("auth.login_failed", user="root", ip="203.0.113.77")
    await audit.record("device.updated", user="admin", device_id=ids[2], fields=["tags"])
    print(f"seeded {len(ids)} agent devices into {db_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: seed_demo.py <new.db> [--many N]")
    target = sys.argv[1]
    if Path(target).exists():
        sys.exit(f"{target} exists - refusing to seed demo accounts into an existing database")
    many = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[2] == "--many" else 0
    asyncio.run(main(target, many))
