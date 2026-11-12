import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInviteUrl,
  emitTogetherInvite,
  onTogetherInvite,
  parseTogetherDeepLink,
  type ParsedInvite,
} from "../src/lib/together/invite";

test("shared invites use the hosted apex and reach the native invite parser", () => {
  const relay = "wss://relay.example.test/base?region=eu&version=11";
  const shared = new URL(buildInviteUrl(relay, "abc234"));
  assert.equal(shared.origin, "https://harborcommunity.site");
  assert.deepEqual(parseTogetherDeepLink(`harbor://together?${shared.searchParams}`), {
    relayUrl: relay,
    roomCode: "ABC234",
  });
});

test("native invites reject other schemes, malformed relays and incomplete rooms", () => {
  const query = new URLSearchParams({
    "harbor-relay": "wss://relay.example.test",
    "harbor-room": "ABC234",
  });
  assert.equal(parseTogetherDeepLink(`https://together?${query}`), null);
  assert.equal(parseTogetherDeepLink(`harbor://together/other?${query}`), null);
  assert.equal(parseTogetherDeepLink(`harbor://together?${query}&harbor-room=XYZ789`), null);
  for (const relay of [
    "javascript:alert(1)",
    "https://relay.example.test",
    "wss://user:password@relay.example.test",
    "wss://relay.example.test/#fragment",
  ]) {
    query.set("harbor-relay", relay);
    assert.equal(parseTogetherDeepLink(`harbor://together?${query}`), null);
  }
  query.set("harbor-relay", "wss://relay.example.test");
  for (const room of ["ABC", "ABC2345", "ABC-23"]) {
    query.set("harbor-room", room);
    assert.equal(parseTogetherDeepLink(`harbor://together?${query}`), null);
  }
});

test("an invite carrying the retired public relay joins through the replacement", () => {
  const query = new URLSearchParams({
    "harbor-relay": "wss://pub.harbor.site",
    "harbor-room": "ABC234",
  });
  assert.deepEqual(parseTogetherDeepLink(`harbor://together?${query}`), {
    relayUrl: "wss://pub.harborcommunity.site",
    roomCode: "ABC234",
  });
});

test("a launch invite is delivered once when the provider subscribes", () => {
  const invite = { relayUrl: "wss://relay.example.test", roomCode: "ABC234" };
  emitTogetherInvite(invite);
  const received: ParsedInvite[] = [];
  const stop = onTogetherInvite((value) => received.push(value));
  assert.deepEqual(received, [invite]);
  stop();
  const stopNext = onTogetherInvite((value) => received.push(value));
  assert.equal(received.length, 1);
  emitTogetherInvite({ ...invite, roomCode: "XYZ789" });
  assert.equal(received[1].roomCode, "XYZ789");
  stopNext();
});
