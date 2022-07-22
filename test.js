const SIGNAL_DB_KEYS = {
  DTLS_CERT: 0,
  ICE_UFRAG: 1,
  ICE_PWD: 2
};

const CANDIDATE_TYPES = {
  host: 0,
  srflx: 1,
  relay: 2
};

const CANDIDATE_TCP_TYPES = {
  active: 0,
  passive: 1,
  so: 2
}

const CANDIDATE_IDX = {
  TYPE: 0,
  PROTOCOL: 1,
  IP: 2,
  PORT: 3,
  RELATED_IP: 4,
  RELATED_PORT: 5,
  TCP_TYPE: 6
}

const STUN_ICE = [
  {urls: 'stun:stun1.l.google.com:19302'},
  {urls: 'stun:stun2.l.google.com:19302'}
];

const TURN_UDP_ICE = [
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  }
];

const TURN_TCP_ICE = [
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  }
];

const POLL_INTERVAL_MS = 5000;

// How long until we expire entries in KV
const STATE_EXPIRATION_MS = 5 * 60 * 1000;

// How long until expiration do we refresh
const REFRESH_WINDOW_MS = 30000;

const ROOM_ID = "room126";
const WORKER_URL = "https://signalling.minddrop.workers.dev"
//const WORKER_URL = "http://localhost:8787"

const domWrite = (...args) => {
  const el = document.createElement("div");
  el.innerText = args.join(" ");
  setTimeout(() => {
    document.body.appendChild(el);
  }, 1000);
};

const hexToBase64 = (hex) => {
  const d = [];

  for (let i = 0; i < hex.length; i += 2) {
    const v = `${hex[i]}${hex[i + 1]}`.toLowerCase();
    d.push(parseInt(v, 16));
  }

  // b64 is slightly more concise than colon-hex
  return btoa(String.fromCharCode.apply(String, d));
}

const base64ToHex = (b64) => {
  const raw = atob(b64);
  let result = '';
  for (let i = 0; i < raw.length; i++) {
    const hex = raw.charCodeAt(i).toString(16);
    result += (hex.length === 2 ? hex : '0' + hex);
  }
  return result.toLowerCase();
};

// parseCandidate from https://github.com/fippo/sdp
const parseCandidate = (line) => {
  let parts;

  // Parse both variants.
  if (line.indexOf('a=candidate:') === 0) {
    parts = line.substring(12).split(' ');
  } else {
    parts = line.substring(10).split(' ');
  }

  const candidate = [
    CANDIDATE_TYPES[parts[7]], // type
    parts[2].toLowerCase() === "udp" ? 0 : 1, // protocol
    parts[4], // ip
    parseInt(parts[5], 10), // port
  ];

  for (let i = 8; i < parts.length; i += 2) {
    switch (parts[i]) {
      case 'raddr':
        while (candidate.length < 5) candidate.push(null);
        candidate[4] = parts[i + 1];
        break;
      case 'rport':
        while (candidate.length < 6) candidate.push(null);
        candidate[5] = parseInt(parts[i + 1], 10);
        break;
      case 'tcptype':
        while (candidate.length < 7) candidate.push(null);
        candidate[6] = CANDIDATE_TCP_TYPES[parts[i + 1]];
        break;
      default: // Unknown extensions are silently ignored.
        break;
    }
  }

  while (candidate.length < 8) candidate.push(null);
  candidate[7] = parseInt(parts[3], 10); // Priority last

  return candidate;
};

function arrayBufferToHex (arrayBuffer) {
  if (typeof arrayBuffer !== 'object' || arrayBuffer === null || typeof arrayBuffer.byteLength !== 'number') {
    throw new TypeError('Expected input to be an ArrayBuffer')
  }

  var view = new Uint8Array(arrayBuffer)
  var result = ''
  var value

  for (var i = 0; i < view.length; i++) {
    value = view[i].toString(16)
    result += (value.length === 1 ? '0' + value : value)
  }

  return result
}

function randomHex (bytes) {
  const view = new Uint8Array(bytes)

  if (typeof crypto === 'object' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(view)
  } else if (typeof msCrypto === 'object' && typeof msCrypto.getRandomValues === 'function') {
    msCrypto.getRandomValues(view)
  } else {
    throw new Error('No secure random number generator available')
  }

  return arrayBufferToHex(view.buffer)
}

const generateRandomString = (length = 20, wishlist = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/') =>
  Array.from(crypto.getRandomValues(new Uint32Array(length))).map((x) => wishlist[x % wishlist.length]).join('');

const clientId = randomHex(20);

if (!history.state?.contextId) {
    history.replaceState({ ...history.state, contextId: randomHex(20)}, window.location.href);
}

const contextId = history.state.contextId;

domWrite("clientId", clientId, hexToBase64(clientId));
domWrite("contextId", contextId, hexToBase64(contextId));

(async function() {
  const getDbData = async () => {
    const dbreq = indexedDB.open("signal-db", 1);

    dbreq.addEventListener("upgradeneeded", ({ target: { result: db } }) => {
      db.createObjectStore("signal-data", { keyPath: "id" });
    });

    const dbData = {};

    await new Promise(res => {
      const ps = [];

      new Promise(res => {
        dbreq.addEventListener("success", async ({ target: { result: db } }) => {
          const fetch = (key, f) => {
            ps.push(new Promise(res => {
              db.transaction("signal-data").objectStore("signal-data").get(key).addEventListener("success", async ({ target: { result } }) => {
                let value;

                if (result?.value) {
                  value = result.value;
                } else {
                  value = await f();
                  await db.transaction("signal-data", "readwrite").objectStore("signal-data").put({ id: key, value });
                }

                dbData[key] = value;
                res();
              })
            }));
          };

          fetch(SIGNAL_DB_KEYS.DTLS_CERT, () => RTCPeerConnection.generateCertificate({ name: "ECDSA", namedCurve: "P-256" }));
          fetch(SIGNAL_DB_KEYS.ICE_UFRAG, async () => generateRandomString(12));
          fetch(SIGNAL_DB_KEYS.ICE_PWD, async () => generateRandomString(32));
          res();
        });
      }).then(() => Promise.all(ps).then(res));
    });

    return dbData;
  };

  const getNetworkSettings = async (dbData) => {
    let dtlsFingerprint = null;
    const candidates = [];

    let iceServers = STUN_ICE;

    const pc = new RTCPeerConnection({ iceServers, certificates: [ dbData[SIGNAL_DB_KEYS.DTLS_CERT] ] });
    pc.createDataChannel("foo");

    const p = new Promise(res => {
      pc.onicecandidate = e => {
        if (!e.candidate) {
          return res();
        }

        if (e.candidate.candidate) {
          candidates.push(parseCandidate(e.candidate.candidate));
        }
      };
    });

    pc.createOffer().then(offer => {
      for (const l of offer.sdp.split("\n")) {
        if (l.indexOf("a=fingerprint") == -1) continue;
        dtlsFingerprint = l.split(" ")[1].trim();
      }

      pc.setLocalDescription(offer)
    });

    await p;

    pc.close();

    let isSymmetric = false;
    let udpEnabled = false;

    // Network is not symmetric if we can find a srflx candidate that has a unique related port
    loop:
    for (const c of candidates) {
      if (c[0] !== CANDIDATE_TYPES.srflx) continue;
      udpEnabled = true;

      let found = false;

      for (const d of candidates) {
        if (d[0] !== CANDIDATE_TYPES.srflx) continue;
        if (c === d) continue;

        if (c[CANDIDATE_IDX.RELATED_PORT] &&
            d[CANDIDATE_IDX.RELATED_PORT] &&
            c[CANDIDATE_IDX.RELATED_PORT] === d[CANDIDATE_IDX.RELATED_PORT] &&
            c[CANDIDATE_IDX.PORT] !== d[CANDIDATE_IDX.PORT]) { // check port and related port
          // Symmetric, continue
          found = true;
        }
      }

      if (!found) {
        isSymmetric = false;
      }
    }

    if (document.location.toString().indexOf("?symtest") >= 0) {
      isSymmetric = true;
    }

    if (isSymmetric) {
      // Need TURN
      iceServers = udpEnabled ? TURN_UDP_ICE : TURN_TCP_ICE;

      const pc = new RTCPeerConnection({iceServers});
      pc.createDataChannel("foo");

      const p = new Promise(res => {
        pc.onicecandidate = e => {
          if (!e.candidate) return res();
        };
      });

      pc.createOffer().then(offer => pc.setLocalDescription(offer))
      await p;
      pc.close();
    }

    return [udpEnabled, isSymmetric, dtlsFingerprint];
  };

  const dbData = await getDbData();

  domWrite("Performing ICE");
  const t0 = performance.now();
  const [udpEnabled, isSymmetric, dtlsFingerprint] = await getNetworkSettings(dbData); 
  domWrite("Done in", Math.floor(performance.now() - t0), "ms symmetric: ", isSymmetric, " udp: ", udpEnabled);

  const createSdp = (isOffer, iceUFrag, icePwd, dtlsFingerprintBase64) => {
    const dtlsHex = base64ToHex(dtlsFingerprintBase64);
    let dtlsFingerprint = "";

    for (let i = 0; i < dtlsHex.length; i += 2) {
      dtlsFingerprint += `${dtlsHex[i]}${dtlsHex[i+1]}${i === dtlsHex.length - 2 ? '' : ':'}`.toUpperCase();
    }

    const sdp = ['v=0',
      'o=- 5498186869896684180 2 IN IP4 127.0.0.1',
      's=-', 't=0 0', 'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      'a=mid:0',
      'a=sctp-port:5000'
    ];

    if (isOffer) {
      sdp.push('a=setup:actpass');
    } else {
      sdp.push('a=setup:active');
    }

    sdp.push(`a=ice-ufrag:${iceUFrag}`);
    sdp.push(`a=ice-pwd:${icePwd}`);
    sdp.push(`a=fingerprint:sha-256 ${dtlsFingerprint}`);

    //let priority = 1;

    //for (const c of candidates) {
    //}

    return sdp.join("\r\n") + "\r\n";
  }

  const handlePeerInfos = (function() {
    const peers = new Map();
    const remotePeerRoles = new Map(); // true if offer, false if answer
    const remoteSdps = new Map();
    const dualSymmetricBPeersAdded = new Set();

    return (localJoinedAtTimestamp, localPeerData, localDtlsCert, localDtlsFingerprintBase64, localPackages, remotePeerDatas, remotePackages) => {
      const [localClientBase64, localSymmetric] = localPeerData;
      const localClientId = base64ToHex(localClientBase64);

      console.log("incoming peers", JSON.stringify(remotePeerDatas));

      for (const remotePeerData of remotePeerDatas) {
        const [remoteClientBase64, remoteSymmetric, remoteDtlsFingerprintBase64, remoteJoinedAtTimestamp] = remotePeerData;
        const remoteClientId = base64ToHex(remoteClientBase64);

        console.log("local vs remote", localClientId, localJoinedAtTimestamp, remoteClientId, remoteJoinedAtTimestamp, localSymmetric === remoteSymmetric);

        //Peer A is:
        //  - if both not symmetric or both symmetric, whoever has the most recent data is peer A, since we want Peer B created faster,
        //    and the KV store latency will be best with older data.
        //  - if one is and one isn't, if this peer is the non-symmetric one, since the prflx candidates must go to the symmetric one (B)
        
        const isPeerA = localSymmetric === remoteSymmetric ? localJoinedAtTimestamp > remoteJoinedAtTimestamp : !localSymmetric;

        // If both sides are symmetric:
        //
        // - Peer A will *also* push packages with candidates (relay)
        // - Peer B should check for packages for itself
        const isDualSymmetric = localSymmetric && remoteSymmetric;

        // If both sides are symmetric, we need to use a TURN server for these peers.
        const iceServers = localSymmetric && remoteSymmetric ? (udpEnabled ? TURN_UDP_ICE : TURN_TCP_ICE) : STUN_ICE;

        if (isPeerA) {
          //  - I create PC
          //  - I create an answer SDP, and munge the ufrag
          //  - Set local description with answer
          //  - Set remote description via the received sdp
          //  - Add the ice candidates

          for (const [ , remoteClientIdBase64, remoteIceUFrag, remoteIcePwd, remoteDtlsFingerprintBase64, localIceUFrag, localIcePwd, remoteCandidates] of remotePackages) {
            if (peers.has(remoteClientId)) continue;

            // I am peer A, I only care if packages have been published to me.
            domWrite("I am peer A for ", remoteClientId,  " is dual: ", isDualSymmetric);

            const pc = new RTCPeerConnection({ iceServers, certificates: [ localDtlsCert ] });
            pc.createDataChannel("signal");
            peers.set(remoteClientId, pc);

            // Special case if both behind sym NAT: peer A needs to send its relay candidates as well.
            if (isDualSymmetric) {
              let pkg = [remoteClientBase64, localClientBase64, /* lfrag */null, /* lpwd */null, /* ldtls */null, /* remote ufrag */ null, /* remote Pwd */ null, []];
              const pkgCandidates = pkg[pkg.length - 1];

              pc.onicecandidate = e => {
                if (!e.candidate) {
                  // If any relay candidates were found, push it in the next step
                  if (pkgCandidates.length > 0) {
                    console.log("Dual case pushing from A", pkg);
                    localPackages.push(pkg);
                  }

                  return;
                }

                if (!e.candidate.candidate) return;
                if (!e.candidate.candidate.indexOf("relay") === -1) return;
                pkgCandidates.push(e.candidate.candidate);
              };
            }

            pc.oniceconnectionstatechange = () => {
              const iceConnectionState = pc.iceConnectionState;
              const iceGatheringState = pc.iceGatheringState;

              if (iceConnectionState === "connected") {
                document.body.style = "background-color: green;";
              }

              console.log("iceconnectionstatechange", iceConnectionState, iceGatheringState);
            }

            pc.onicegatheringstatechange = () => {
              const iceConnectionState = pc.iceConnectionState;
              const iceGatheringState = pc.iceGatheringState;
              console.log("icegatheringstatechange", iceConnectionState, iceGatheringState);
            }

            pc.onconnectionstatechange = () => {
              const connectionState = pc.connectionState;
              console.log("connectionstatechange", connectionState);
            }

            pc.onsignalingstatechange = () => {
              const signalingState = pc.signalingState;
              console.log("signalingstatechange", signalingState);
            }

            const remoteSdp = createSdp(true, remoteIceUFrag, remoteIcePwd, remoteDtlsFingerprintBase64);

            pc.setRemoteDescription({ type: "offer", sdp: remoteSdp });

            pc.createAnswer().then(answer => {
              const lines = [];

              for (const l of answer.sdp.split("\r\n")) {
                if (l.startsWith("a=ice-ufrag")) {
                  lines.push(`a=ice-ufrag:${localIceUFrag}`);
                } else if (l.startsWith("a=ice-pwd")) {
                  lines.push(`a=ice-pwd:${localIcePwd}`);
                } else {
                  lines.push(l);
                }
              }

              pc.setLocalDescription({ type: "answer", sdp: lines.join("\r\n") });
              
              for (const candidate of remoteCandidates) {
                domWrite("adding candidate for ", remoteClientId, candidate);
                pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
              }
            });
          }
        } else {
          // I am peer B, I need to create a peer first if none exists, and send a package.
          //   - Create PC
          //   - Create offer
          //   - Set local description as-is
          //   - Generate ufrag + pwd
          //   - Generate remote SDP using the dtls fingerprint for A, and my generated ufrag + pwd
          //   - Set remote description
          //   - Let trickle run, then once trickle finishes send a package for A to pick up = [my client id, my offer sdp, generated ufrag/pwd, dtls fingerprint, ice candidates]
          //   - keep the icecandidate listener active, and add the pfrlx candidates when they arrive (but don't send another package)
          if (!peers.has(remoteClientId)) {
            const pc = new RTCPeerConnection({ iceServers, certificates: [ localDtlsCert ] });
            pc.createDataChannel("signal");
            peers.set(remoteClientId, pc);

            domWrite("I am peer B for ", remoteClientId, " is dual: ", isDualSymmetric);

            const remoteUfrag = generateRandomString(12);
            const remotePwd = generateRandomString(32);
            const remoteSdp = createSdp(false, remoteUfrag, remotePwd, remoteDtlsFingerprintBase64);
            let trickleDone = false;

            // This is the 'package' sent to peer B that it needs to start ICE
            let pkg = [remoteClientBase64, localClientBase64, /* lfrag */null, /* lpwd */null, /* ldtls */null, remoteUfrag, remotePwd, []];
            const pkgCandidates = pkg[pkg.length - 1];

            pc.onicecandidate = e => {
              // Push package onto the given package list, so it will be sent in next polling step.
              if (!e.candidate) {
                domWrite("Pushing candidates from B", pkg);
                return localPackages.push(pkg);
              }

              if (!e.candidate.candidate) return;
              pkgCandidates.push(e.candidate.candidate);
            };

            pc.oniceconnectionstatechange = () => {
              const iceConnectionState = pc.iceConnectionState;
              const iceGatheringState = pc.iceGatheringState;

              if (iceConnectionState === "connected") {
                document.body.style = "background-color: green;";
              }

              console.log("iceconnectionstatechange", iceConnectionState, iceGatheringState);
            }

            pc.onicegatheringstatechange = () => {
              const iceConnectionState = pc.iceConnectionState;
              const iceGatheringState = pc.iceGatheringState;
              console.log("icegatheringstatechange", iceConnectionState, iceGatheringState);
            }

            pc.onconnectionstatechange = () => {
              const connectionState = pc.connectionState;
              console.log("connectionstatechange", connectionState);
            }

            pc.onsignalingstatechange = () => {
              const signalingState = pc.signalingState;
              console.log("signalingstatechange", signalingState);
            }

            pc.createOffer().then(offer => {
              pc.setLocalDescription(offer);

              for (const l of offer.sdp.split("\r\n")) {
                switch (l.split(':')[0]) {
                  case 'a=ice-ufrag':
                    pkg[2] = l.substring(12);
                    break;
                  case 'a=ice-pwd':
                    pkg[3] = l.substring(10);
                    break;
                  case 'a=fingerprint':
                    pkg[4] = hexToBase64(l.substring(22).replaceAll(":",""))
                    break;
                }
              }

              pc.setRemoteDescription({ type: "answer", sdp: remoteSdp });
            });
          }

          if (isDualSymmetric) {
            // Peer B will also receive relay candidates if both sides are symmetric.
            for (const [, remoteClientIdBase64, , , , , , remoteCandidates] of remotePackages) {
              const remoteClientId = base64ToHex(remoteClientBase64);

              // If we already added the relay candidates from A, skip
              if (dualSymmetricBPeersAdded.has(remoteClientId)) continue;

              if (!peers.has(remoteClientId)) continue;
              const pc = peers.get(remoteClientId);

              if (remoteCandidates.length > 0) {
                for (const candidate of remoteCandidates) {
                  console.log("dual case, adding to B", candidate);
                  pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
                }

                dualSymmetricBPeersAdded.add(remoteClientId);
              }
            }
          }
        }
      }
    };
  })();

  const step = (function() {
    let dataTimestamp = null;
    let isSending = false;
    let packages = [];
    let lastPackagesLength = null;
    let sentFirstPoll = false;
    let joinedAtTimestamp = new Date().getTime();

    return async () => {
      if (isSending) return;

      isSending = true;

      try {
        const now = new Date().getTime();

        const localDtlsFingerprintBase64 = hexToBase64(dtlsFingerprint.replaceAll(":", ""));

        const localPeerInfo =  [
          hexToBase64(clientId),
          isSymmetric,
          localDtlsFingerprintBase64,
          joinedAtTimestamp
        ];

        const payload = { r: ROOM_ID, k: hexToBase64(contextId) };
        const expired = dataTimestamp === null || (now - dataTimestamp) >= STATE_EXPIRATION_MS - REFRESH_WINDOW_MS;
        const packagesChanged = lastPackagesLength !== packages.length;
        lastPackagesLength = packages.length;

        if (expired || packagesChanged) {
          // This will force a write
          dataTimestamp = now;
          
          // TODO compact packages here to reduce bandwidth
        }

        // The first poll should just be a read, no writes, to build up packages before we do a write
        // to reduce worker KV I/O. So don't include the data + packages on the first request.
        if (sentFirstPoll) {
          payload.d = localPeerInfo;
          payload.t = dataTimestamp;
          payload.x = STATE_EXPIRATION_MS;
          payload.p = packages;
        }

        const res = await fetch(WORKER_URL, {
          method: "POST",
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        
        const { peers: responsePeerList, packages: responsePackages } = await res.json();

        // Slight optimization: if the peers are empty on the first poll, immediately publish data to reduce
        // delay before first peers show up.
        if (responsePeerList.length === 0 && !sentFirstPoll) {
          payload.d = localPeerInfo;
          payload.t = dataTimestamp;
          payload.x = STATE_EXPIRATION_MS;
          payload.p = packages;

          await fetch(WORKER_URL, {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        }

        sentFirstPoll = true;

        handlePeerInfos(joinedAtTimestamp, localPeerInfo, dbData[SIGNAL_DB_KEYS.DTLS_CERT], localDtlsFingerprintBase64, packages, responsePeerList, responsePackages);
      } catch (e) {
        console.error(e);
      } finally {
        isSending = false;
      }
    }
  })()

  step();

  setInterval(step, 1000);
})();
