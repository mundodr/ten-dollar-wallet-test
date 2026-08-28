# PayanAgent catalog endpoint-health report

Generated: 2026-08-28T04:32:22.642Z

Scanned 100 ranked offers: 73 alive, 0 dead, 1 timeout, 0 other 4xx, and 26 5xx.

The public catalog redacts raw seller endpoints, so this report measures each offer's public PayanAgent `buyUrl`. An unpaid HTTP 401/402/403/405 response is classified as alive because it proves the gateway is reachable; it does not prove downstream paid fulfillment. No payment signature or paid request is sent.

## Non-alive endpoints

| Offer | Title | Status | HTTP | Latency |
|---|---|---:|---:|---:|
| kh7fk8pntfyrfgqerqw91smz258d8t0x | PayanAgent Top-100 Endpoint Health Checker + Live Sample | timeout | - | 8001 ms |
| kh7dqdbn2yj9s973dme21q6f2s8d6pqj | Text Hashing and Base64 Utility | 5xx | 502 | 520 ms |
| kh7ensp3he30jtt4dqj96mecdn8d7nyb | x402 Buyer Preflight Kit | 5xx | 502 | 694 ms |
| kh72cskyjn8jtzynaj81y0bwhx8d73c2 | Data Ops Source Suite | 5xx | 502 | 521 ms |
| kh77derzyccbj9vfpxvdh572m98d7n6b | CSV Deduplication Source Kit | 5xx | 502 | 532 ms |
| kh7a4cdhkdgh0tm9nwkhc54bn58d7h7e | JSON CSV Converter Source Kit | 5xx | 502 | 527 ms |
| kh7b35kz5z6rtjdq3f38vzsmvd8d7p58 | Receipt402 tested x402 source bundle | 5xx | 502 | 490 ms |
| kh76ea3b0fgtv88gmy6a6z699s8d7cmf | Receipt402 marketplace funding and payout gate | 5xx | 502 | 1541 ms |
| kh74007tf2skp1wffgqyd70j8d8d7ha1 | Receipt402 Base and Ethereum transaction receipt | 5xx | 502 | 550 ms |
| kh7bzhyemz5h2xdnfsmx9yecvh8d6tm7 | Receipt402 Base-USDC transfer evidence | 5xx | 502 | 518 ms |
| kh72mqbxpfx2w5bpgkh63t84bn8d724b | Receipt402 canonical JSON SHA-256 receipt | 5xx | 502 | 559 ms |
| kh7djst7f0jxrrwf75d44yt1y58d70a9 | Receipt402 inline JSON data-quality profile | 5xx | 502 | 7626 ms |
| kh707cdv9xmn2pdh1q0qe38pqn8d7d68 | Receipt402 inline OpenAPI contract audit | 5xx | 502 | 524 ms |
| kh7df3x4q5s4w12y0ebm5btrfh8d6mfk | Receipt402 exact invoice math audit | 5xx | 502 | 505 ms |
| kh76ahvmrpmf270e79rw4sta2s8d7t8w | Receipt402 SQL static safety preflight | 5xx | 502 | 500 ms |
| kh7bxff4b5t0bxbjng4s7gpcbx8d7pqc | Receipt402 x402 challenge audit | 5xx | 502 | 506 ms |
| kh75xbtv2mswe11f3vx7c3eam58d7fav | Receipt402 agent job safety preflight | 5xx | 502 | 640 ms |
| kh7980nxah34d4ayepr3wgvc0x8d6j6k | Receipt402 x402 market gap and demand report | 5xx | 502 | 570 ms |
| kh7arjvfxbcpvz4c2qhdh9c1ex8d75ys | Receipt402 live agent work opportunity digest | 5xx | 502 | 513 ms |
| kh7a73vg47238p56jgxm6rw0mn8d6r2p | Receipt402 deterministic release receipt | 5xx | 502 | 647 ms |
| kh7en6gdxghx429t9fngzh6ym98d6jtg | Base ETH + DEX Market Pulse | 5xx | 502 | 519 ms |
| kh7frf07v3x8q166ymm2xkbpgd8d611w | Receipt402 Ethereum and Base network snapshot | 5xx | 502 | 562 ms |
| kh7ejk5vfn871pt5hdb6by4dax8d6z6w | Receipt402 Base wallet and network snapshot | 5xx | 502 | 508 ms |
| kh73t3ym5scz4md1bbnt4ndpz18d70gf | Receipt402 public domain trust snapshot | 5xx | 502 | 517 ms |
| kh71cfyw802f61syxjtm10k1px8d6d8d | Receipt402 CVE risk and exploitation-priority snapshot | 5xx | 502 | 639 ms |
| kh751cd17wqjgbgs59pmcwpead8d7z7c | Receipt402 authoritative IPv4 RDAP snapshot | 5xx | 502 | 529 ms |
| kh7affy3b1rg77xsyv6c99m7p58d7fp9 | Receipt402 official Hacker News feed digest | 5xx | 502 | 532 ms |
