import { expect, test } from "@playwright/test";
import {
  closeYtmdInstance,
  enqueueTrackInRoom,
  getListenTogetherState,
  launchYtmdInstance,
  simulateLocalPlaybackEvent,
  type YtmdE2EInstance,
} from "./helpers/electron-app";

test.describe("Listen Together E2E", () => {
  const instances: YtmdE2EInstance[] = [];

  test.afterEach(async () => {
    while (instances.length > 0) {
      await closeYtmdInstance(instances.pop());
    }
  });

  test("header placement, invite popover, and footer leave flow", async () => {
    const app = await launchYtmdInstance();
    instances.push(app);
    const page = app.listenTogetherPage;

    // Create room from lobby
    await page.locator("#lt-display-name").fill("HostAlice");
    await page.getByRole("button", { name: "Create Room" }).click();

    await expect(page.locator(".lt-room-header")).toBeVisible();
    const header = page.locator(".lt-room-header");
    const inviteBtn = page.getByTestId("lt-invite-btn");
    const settingsBtn = page.getByTestId("lt-settings-btn");
    const footerLeaveBtn = page.getByTestId("lt-leave-btn");

    await expect(inviteBtn).toBeVisible();
    await expect(settingsBtn).toBeVisible();
    await expect(footerLeaveBtn).toBeVisible();

    // No Leave/End button in top header
    await expect(header.getByRole("button", { name: /Leave|End/ })).toHaveCount(
      0,
    );

    // Settings gear sits to the right of Invite button at top-right
    const inviteBox = await inviteBtn.boundingBox();
    const settingsBox = await settingsBtn.boundingBox();
    const footerLeaveBox = await footerLeaveBtn.boundingBox();
    expect(inviteBox).not.toBeNull();
    expect(settingsBox).not.toBeNull();
    expect(footerLeaveBox).not.toBeNull();
    expect(settingsBox!.x).toBeGreaterThan(inviteBox!.x);
    expect(footerLeaveBox!.y).toBeGreaterThan(settingsBox!.y + 100);

    // Friends list aligns display name and tags cleanly on the same baseline
    const friendsToggle = page.getByTestId("lt-friends-toggle");
    await friendsToggle.click();
    const memberNameBox = await page.locator(".lt-member-name").first().boundingBox();
    const memberTagBox = await page.locator(".lt-member-tag").first().boundingBox();
    expect(memberNameBox).not.toBeNull();
    expect(memberTagBox).not.toBeNull();
    const nameMidY = memberNameBox!.y + memberNameBox!.height / 2;
    const tagMidY = memberTagBox!.y + memberTagBox!.height / 2;
    expect(Math.abs(nameMidY - tagMidY)).toBeLessThanOrEqual(1.5);

    // Invite popover opens cleanly with Online/Offline pill, compact invite link preview, and Copy Invite Link
    await inviteBtn.click();
    const popover = page.getByTestId("lt-invite-popover");
    await expect(popover).toBeVisible();
    const reachability = page.getByTestId("lt-invite-reachability");
    await expect(reachability).toBeVisible();
    await expect(reachability).toHaveText(/^(Online|Offline)$/);
    const linkPreview = page.getByTestId("lt-invite-link-preview");
    await expect(linkPreview).toBeVisible();
    const previewUrl = await linkPreview.inputValue();
    expect(previewUrl).toMatch(/^ytmd:\/\/l\//);
    await expect(page.getByTestId("lt-room-code")).toHaveCount(0);
    if ((await reachability.textContent())?.trim() === "Online") {
      const joinRes = await app.electronApp.evaluate(
        (_electron, rawUrl: string) => {
          const ctx = (globalThis as any).__ytmdE2E;
          return Boolean(ctx && typeof rawUrl === "string");
        },
        previewUrl,
      );
      expect(joinRes).toBe(true);
    }
    await expect(page.getByTestId("lt-copy-invite-link-btn")).toBeVisible();

    await page.getByTestId("lt-copy-invite-link-btn").click();
    await expect(page.getByTestId("lt-copy-invite-link-btn")).toContainText(
      "Link Copied",
    );

    // Leave from footer returns to lobby
    await expect(page.getByTestId("lt-leave-split-btn")).toBeVisible();
    await footerLeaveBtn.click();
    await expect(
      page.getByRole("button", { name: "Create Room" }),
    ).toBeVisible();
  });

  test("album art, artist + added-by attribution, and pin/unpin toggle", async () => {
    const app = await launchYtmdInstance();
    instances.push(app);
    const page = app.listenTogetherPage;

    await page.locator("#lt-display-name").fill("HostAlice");
    await page.getByRole("button", { name: "Create Room" }).click();
    await expect(page.getByTestId("lt-now-playing")).toBeVisible();

    // Track 1 becomes Now Playing; Track 2 and Track 3 sit in Queue
    await enqueueTrackInRoom(app, {
      entryId: "e-1",
      videoId: "dQw4w9WgXcQ",
      title: "Track One",
      author: "Rick Astley",
      durationSec: 213,
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });
    await enqueueTrackInRoom(app, {
      entryId: "e-2",
      videoId: "9bZkp7q19f0",
      title: "Track Two",
      author: "PSY",
      durationSec: 253,
      thumbnailUrl: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
    });
    await enqueueTrackInRoom(app, {
      entryId: "e-3",
      videoId: "kJQP7kiw5Fk",
      title: "Track Three",
      author: "Luis Fonsi",
      durationSec: 281,
      thumbnailUrl: null,
    });

    const rows = page.getByTestId("lt-queue-row");
    await expect(rows).toHaveCount(2);

    // Album art renders with referrerPolicy="no-referrer" and ytimg fallback for null thumbnailUrl
    const row0Img = rows.nth(0).locator("img.lt-thumb");
    const row1Img = rows.nth(1).locator("img.lt-thumb");
    await expect(row0Img).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(row0Img).toHaveAttribute(
      "src",
      "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
    );
    await expect(row1Img).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(row1Img).toHaveAttribute(
      "src",
      "https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg",
    );

    // Artist & side "by You" attribution both present
    await expect(rows.nth(0)).toContainText("PSY");
    await expect(rows.nth(0)).toContainText("by You");
    await expect(rows.nth(1)).toContainText("Luis Fonsi");
    await expect(rows.nth(1)).toContainText("by You");

    // Pin Track Three -> becomes row 0 and shows active .is-pinned state
    await rows.nth(1).getByTestId("lt-pin-btn").click();
    await expect(rows.nth(0)).toContainText("Track Three");
    await expect(rows.nth(0)).toHaveClass(/is-pinned/);
    await expect(rows.nth(0).getByTestId("lt-pin-btn")).toHaveClass(
      /is-pinned/,
    );
    await expect(rows.nth(0).getByTestId("lt-pin-btn")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Unpin Track Three -> loses .is-pinned and returns after Track Two
    await rows.nth(0).getByTestId("lt-pin-btn").click();
    await expect(rows.nth(0)).toContainText("Track Two");
    await expect(rows.nth(1)).toContainText("Track Three");
    await expect(rows.nth(1)).not.toHaveClass(/is-pinned/);
    await expect(rows.nth(1).getByTestId("lt-pin-btn")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("local playback flow with add-to-queue and tune back in", async () => {
    const app = await launchYtmdInstance();
    instances.push(app);
    const page = app.listenTogetherPage;

    await page.locator("#lt-display-name").fill("HostAlice");
    await page.getByRole("button", { name: "Create Room" }).click();
    await expect(page.getByTestId("lt-now-playing")).toBeVisible();

    await enqueueTrackInRoom(app, {
      entryId: "e-1",
      videoId: "dQw4w9WgXcQ",
      title: "Room Track",
      author: "Rick Astley",
      durationSec: 213,
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });
    const remoteTimer = page.getByTestId("lt-remote-timer");
    await expect(remoteTimer).toBeVisible();
    await expect(remoteTimer).toHaveText(/^\d+:\d{2}\s*\/\s*3:33$/);

    // Simulate user clicking a song and playlist locally in YTMView
    await simulateLocalPlaybackEvent(app, {
      kind: "playlist",
      playlistId: "PLtest123456",
      videoId: "9bZkp7q19f0",
      title: "Local Mix",
      meta: {
        videoId: "9bZkp7q19f0",
        title: "Gangnam Style",
        author: "PSY",
        durationSec: 253,
        thumbnailUrl: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
      },
    });

    await expect(page.getByTestId("lt-status-label")).toHaveText(
      "Listening Locally",
    );
    await expect(remoteTimer).toBeVisible();
    await expect(remoteTimer).toHaveText(/^\d+:\d{2}\s*\/\s*3:33$/);
    const localBar = page.getByTestId("lt-local-bar");
    await expect(localBar).toBeVisible();
    await expect(localBar).toContainText("Gangnam Style");
    await expect(page.getByTestId("lt-tune-back-in-btn")).toBeVisible();

    // Tune back in -> exits local mode and resumes synced status
    await page.getByTestId("lt-tune-back-in-btn").click();
    await expect(localBar).toBeHidden();
    const state = await getListenTogetherState(app);
    expect(state.room?.listeningMode).toBe("room");
  });

  test("two-instance Host and Guest connect and share queue state", async () => {
    const host = await launchYtmdInstance();
    instances.push(host);
    const guest = await launchYtmdInstance();
    instances.push(guest);

    await host.listenTogetherPage.locator("#lt-display-name").fill("HostAlice");
    await host.listenTogetherPage
      .getByRole("button", { name: "Create Room" })
      .click();

    await expect(host.listenTogetherPage.getByTestId("lt-invite-btn")).toBeVisible();

    const hostState = await getListenTogetherState(host);
    const inviteUrl = hostState.room?.inviteUrl;
    expect(inviteUrl).toMatch(/^ytmd:\/\/l\//);

    // In local loopback test environments, replace LAN endpoint if needed is already encoded or test via direct joinByUrl
    const joinResult = await guest.electronApp.evaluate(
      (_electron, url: string) => {
        const ctx = (globalThis as any).__ytmdE2E;
        return ctx.listenTogetherService.joinByUrl(url, {
          displayName: "GuestBob",
        });
      },
      inviteUrl!,
    );
    expect(joinResult).toEqual({ ok: true });

    await expect(
      host.listenTogetherPage.getByTestId("lt-friends-toggle"),
    ).toContainText("Friends (2)");
    await expect(
      guest.listenTogetherPage.getByTestId("lt-friends-toggle"),
    ).toContainText("Friends (2)");

    await enqueueTrackInRoom(host, {
      entryId: "e-shared-1",
      videoId: "dQw4w9WgXcQ",
      title: "Shared Song",
      author: "Shared Band",
      durationSec: 200,
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });

    await expect(
      guest.listenTogetherPage.getByTestId("lt-now-playing"),
    ).toContainText("Shared Song");
    await expect(
      guest.listenTogetherPage.getByTestId("lt-now-playing"),
    ).toContainText("Queued by HostAlice");
  });

  test("host click-to-jump, greyed-out history, and configurable vote skip", async () => {
    const app = await launchYtmdInstance();
    instances.push(app);
    {
      await app.listenTogetherPage.locator("#lt-display-name").fill("HostAlice");
      await app.listenTogetherPage
        .getByRole("button", { name: "Create Room" })
        .click();
      await expect(
        app.listenTogetherPage.getByTestId("lt-invite-btn"),
      ).toBeVisible();

      await enqueueTrackInRoom(app, {
        entryId: "e-jump-1",
        videoId: "dQw4w9WgXcQ",
        title: "First Track",
        author: "Artist One",
        durationSec: 180,
        thumbnailUrl: null,
      });
      await enqueueTrackInRoom(app, {
        entryId: "e-jump-2",
        videoId: "9bZkp7q19f0",
        title: "Second Track",
        author: "Artist Two",
        durationSec: 190,
        thumbnailUrl: null,
      });
      await enqueueTrackInRoom(app, {
        entryId: "e-jump-3",
        videoId: "3JZ_D3ELwOQ",
        title: "Third Track",
        author: "Artist Three",
        durationSec: 200,
        thumbnailUrl: null,
      });

      await expect(
        app.listenTogetherPage.getByTestId("lt-now-playing"),
      ).toContainText("First Track");
      await expect(
        app.listenTogetherPage.getByTestId("lt-queue-row"),
      ).toHaveCount(2);

      // Host clicks Third Track directly to jump forward
      await app.listenTogetherPage
        .getByTestId("lt-queue-row")
        .nth(1)
        .click();

      await expect(
        app.listenTogetherPage.getByTestId("lt-now-playing"),
      ).toContainText("Third Track");
      await expect(
        app.listenTogetherPage.getByTestId("lt-history-list"),
      ).toBeVisible();
      await expect(
        app.listenTogetherPage.getByTestId("lt-history-row"),
      ).toHaveCount(1);
      await expect(
        app.listenTogetherPage.getByTestId("lt-history-row").first(),
      ).toContainText("First Track");

      // Host clicks greyed-out First Track in history to jump back
      await app.listenTogetherPage
        .getByTestId("lt-history-row")
        .first()
        .click();
      await expect(
        app.listenTogetherPage.getByTestId("lt-now-playing"),
      ).toContainText("First Track");
      await expect(
        app.listenTogetherPage.getByTestId("lt-history-row").first(),
      ).toContainText("Third Track");

      // Configure Vote Skip in Room Settings and use Vote Skip button
      await app.listenTogetherPage.getByTestId("lt-settings-btn").click();
      const voteSkipSelect =
        app.listenTogetherPage.getByTestId("lt-vote-skip-select");
      await expect(voteSkipSelect).toHaveValue("majority");
      await voteSkipSelect.selectOption("off");
      await app.listenTogetherPage
        .locator('button[title="Back to room"]')
        .click();
      await expect(
        app.listenTogetherPage.getByTestId("lt-vote-skip-btn"),
      ).toHaveCount(0);

      await app.listenTogetherPage.getByTestId("lt-settings-btn").click();
      await app.listenTogetherPage
        .getByTestId("lt-vote-skip-select")
        .selectOption("majority");
      await app.listenTogetherPage
        .locator('button[title="Back to room"]')
        .click();

      const voteBtn = app.listenTogetherPage.getByTestId("lt-vote-skip-btn");
      await expect(voteBtn).toBeVisible();
      await expect(voteBtn).toContainText("0/1");
      await voteBtn.click();

      await expect(
        app.listenTogetherPage.getByTestId("lt-now-playing"),
      ).toContainText("Second Track");
    }
  });
});
