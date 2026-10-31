#!/bin/sh
# One line per shape: "<id> | <result>". Run with sh in each image; results are compared across images.
cd /tmp && rm -rf w && mkdir w && cd w || exit 1
r() { printf '%s | %s\n' "$1" "$2"; }
one() { printf '%s' "$1" | tr '\n' '~'; }

r sh-is "$(readlink -f /bin/sh 2>/dev/null | sed 's#.*/##')"

# --- common functions (posix-script.ts COMMON_FUNCTIONS)
r fact-tr "$(printf '%s' 'a
b' | tr '\n\r' '  ' | od -c | head -1 | sed 's/  */ /g')"
r date-s "$(date +%s | grep -c '^[0-9][0-9]*$')"
r elapsed-arith "$(echo $(( ( $(date +%s) - 5 ) * 1000 )) | grep -c '^[0-9]*$')"
r command-v "$(command -v sh >/dev/null 2>&1; echo $?)"

# --- lock (LOCK_FUNCTIONS)
: > lock1
r ln-hard-ok "$(ln lock1 lock1.target 2>&1; echo "st=$?")"
r ln-hard-exists "$(one "$(ln lock1 lock1.target 2>&1; echo "st=$?")")"
r flock-n "$( (exec 9>>lockf; flock -n 9; echo "first=$?"; ( exec 8>>lockf; flock -n 8 2>&1; echo "second=$?" ) ) 2>&1 | tr '\n' ' ')"
r lock-open-dir "$( ( exec 9>>"/proc/nosuch/x" ) 2>&1 | sed 's/^[^:]*: //' | head -1; echo st=$? )"
r true-append-dir "$( { true >>"/tmp/w" ; } 2>&1 | sed 's/^[^:]*: //' | head -1)"

# --- sed/head/tail (CLI_FUNCTIONS, start script)
r sed-listening "$(printf 'x\nListening on 127.0.0.1:123\nListening on 127.0.0.1:456\n' | sed -n 's/^Listening on 127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' | head -n 1)"
r sed-ready "$(printf 'Extension host agent listening on 8080\n' | sed -n 's/^Extension host agent listening on \([0-9][0-9]*\)$/\1/p' | tail -n 1)"
r sed-ready-socket "$(printf 'Extension host agent listening on /tmp/a.sock\n' | sed -n 's/^Extension host agent listening on \(\/[^ ]*\)$/\1/p' | tail -n 1)"
r grep-q-cve "$(printf '* !!!! Server terminated due to presence of CVE-2020-1416 !!!!\n' | grep -q '^\* !!!! Server terminated due to presence of CVE-2020-1416 !!!!$'; echo $?)"
r grep-q-port "$(printf -- '--port: Could not find free port in range: 1-2\n' | grep -q '^--port: Could not find free port in range: '; echo $?)"
r grep-o-http "$(printf 'HTTP/1.1 404 Not Found\nHTTP/1.0 200\n' | grep -o 'HTTP/1\.[01] [0-9][0-9][0-9]' | tail -n 1)"
r wget-busybox-probe "$(wget --help 2>&1 </dev/null | grep -i busybox >/dev/null 2>&1; echo $?)"
r tail-cut "$(printf 'one\ntwo twotwo\n' | tail -n 1 | cut -c1-5)"
r cut-c-head "$(printf '%s' 0123456789012345678901234567890123456789abc | cut -c1-40)"
r cut-c-multibyte "$(printf '%s' 'ééé' | cut -c1-2 | od -An -c | tr -s ' ')"
r tr-d-r "$(printf 'a\r\nb\r\n' | tr -d '\r' | od -An -c | tr -s ' ')"

# --- unpack (UNPACK_FUNCTIONS)
mkdir -p src/top/sub && : > src/top/sub/f1 && : > src/top/f2 && echo x > src/top/.hidden
tar -czf t.tgz -C src top 2>/dev/null
r tar-version "$(tar --version 2>&1 | head -1 | sed 's/ *[0-9].*//')"
r tar-list-count "$(tar -tzf t.tgz </dev/null 2>/dev/null | wc -l | tr -d ' ')"
mkdir -p out
r tar-extract-v "$( { tar -xzvf t.tgz -C out </dev/null 2>&1; echo "code=$?"; } | tr '\n' ' ')"
r tar-extract-status "$( { tar -xzvf t.tgz -C out </dev/null 2>&1; echo $? >out.status; } | wc -l | tr -d ' '; cat out.status 2>/dev/null)"
r tar-bad "$(printf 'notatar' >bad.tgz; tar -tzf bad.tgz </dev/null 2>/dev/null | wc -l | tr -d ' '; echo "st=$?")"
r glob-dot "$(for E in out/* out/.[!.]*; do [ -e "$E" ] || continue; printf '%s ' "$E"; done)"
r mv-into "$(mkdir -p dst; mkdir -p srcd/a; echo 1 >srcd/a/x; mv srcd/a dst/ && ls dst/a)"
r mv-onto-dir "$(mkdir -p m1/a m2/a; echo 1 >m1/a/x; mv m1/a m2/ 2>&1 | sed 's/^[^:]*: //' ; echo st=$?)"
r mv-f "$(echo n >p.part; echo o >p; mv -f p.part p && cat p)"
r rm-rf-missing "$(rm -rf nonexistent-dir; echo $?)"
r rm-f-missing "$(rm -f nonexistent-file; echo $?)"
r rm-rf-guard "$(X=/tmp/w; rm -rf "${X:?}/zzz"; echo $?)"
r mkdir-p-multi "$(mkdir -p mp1/a/b mp2/c; ls -d mp1/a/b mp2/c | tr '\n' ' ')"
r mkdir-p-exists "$(mkdir -p mp1; echo $?)"
r mkdir-file "$(: >aFile; one "$(mkdir aFile/g 2>&1; echo "st=$?")")"
r mkdir-p-file "$(one "$(mkdir -p aFile/g 2>&1; echo "st=$?")")"
r mkdir-dashdash-exists "$(one "$(mkdir -- mp1 2>&1; echo "st=$?")")"
r mkdir-denied "$(one "$(mkdir /proc/x/y 2>&1; echo "st=$?")")"
r chmod-dashdash "$(mkdir cm; chmod 0777 -- cm; ls -ld cm | cut -c1-10)"
r chmod-plusx "$(: >px; chmod +x px; ls -l px | cut -c1-10)"

# --- tree install (TREE_FUNCTIONS)
r ln-s "$(ln -s tgt lnk 2>&1; echo st=$?; readlink lnk)"
r ln-s-exists "$(one "$(ln -s tgt2 lnk 2>&1; echo "st=$?")")"
r ln-sfn "$(ln -sfn tgt3 lnk; readlink lnk)"
r readlink-dashdash "$(readlink -- lnk)"
r readlink-notlink "$(one "$(readlink aFile 2>&1; echo "st=$?")")"
r dash-test-L "$([ -L lnk ] && echo L)"

# --- processes (PROCESS_FUNCTIONS / STOP_FUNCTIONS)
sleep 30 & SP=$!
r proc-cmdline-tr "$(tr '\0' ' ' </proc/$SP/cmdline | od -An -c | tr -s ' ')"
r proc-cmdline-nl "$(tr '\0' '\n' </proc/$SP/cmdline | head -n 2 | tr '\n' '~')"
r proc-cmdline-sed "$(tr '\0' '\n' </proc/$SP/cmdline | sed -n 1p)"
r ps-p-args "$(ps -p $SP -o args= 2>&1 | head -2 | tr '\n' '~')"
r ps-pid-args "$(ps -o pid= -o args= 2>&1 | sed -n "s/^ *$SP //p" | head -1)"
r kill-0 "$(kill -0 $SP 2>/dev/null; echo $?)"
r pkill-P "$(have() { command -v "$1" >/dev/null 2>&1; }; have pkill && echo have-pkill || echo no-pkill)"
kill $SP 2>/dev/null
r proc-glob "$(for D in /proc/[0-9]*; do P=${D#/proc/}; [ "$P" = "$$" ] && continue; echo $P; done | head -1 | grep -c '^[0-9]*$')"
r folder-kind-len "$(H=$(printf '%s' abcdef0123abcdef0123abcdef0123abcdef0123-x | cut -c1-40); echo "${#H}")"

# --- ls
mkdir -p lsd; : > lsd/a; sleep 1; : > lsd/b
r ls-t "$(ls -t lsd | tr '\n' ' ')"
: > tokf; chmod 600 tokf
r ls-ln-mode "$(ls -ln tokf | cut -c1-10)"
r ls-ln-case "$(case $(ls -ln tokf 2>/dev/null) in -rw-------*|-r--------*) echo ok ;; *) echo no ;; esac)"

# --- token and random (bootstrap.ts)
r tr-dc-token "$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32 | wc -c | tr -d ' ')"
r tr-dc-token-stderr "$( ( tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32 >tok1 ) 2>&1; echo "st=$? len=$(wc -c <tok1 | tr -d ' ')")"
r tr-dc-umask "$( (umask 077; tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32 >tok2) 2>&1; ls -l tok2 | cut -c1-10)"
r tr-dc-hex "$(tr -dc 'a-f0-9' </dev/urandom | head -c 32 | wc -c | tr -d ' ')"
r tr-dc-variant "$(tr -dc '89ab' </dev/urandom | head -c 1 | grep -c '^[89ab]$')"
r sed-uuid "$(printf '%s' 0123456789abcdef0123456789abcdef | sed "s/^\(........\)\(....\).\(...\).\(...\)\(............\)$/\1-\2-4\3-9\4-\5/")"
r wc-c-redirect "$(wc -c <tok1 | od -An -c | tr -s ' ')"
r head-c-short "$(printf 'abc' | head -c 32 | wc -c | tr -d ' ')"

# --- timing and background
r sleep-frac "$(sleep 0.2 2>/dev/null; echo $?)"
r nohup-bg "$(nohup sleep 1 </dev/null >nl.log 2>&1 9>&- & wait; echo "st=$? log=$(wc -c <nl.log | tr -d ' ')")"
r nohup-stderr "$(nohup sleep 0 2>&1 </dev/null | head -1)"
r setsid "$(setsid sh -c 'echo ok' </dev/null 2>&1)"
r mktemp-d "$(D=$(mktemp -d 2>/dev/null) && [ -d "$D" ] && echo ok; rmdir "$D" 2>/dev/null)"
r kill-group "$(sleep 30 & P=$!; kill -9 -"$P" "$P" 2>&1 | sed 's/^[^:]*: //'; wait $P 2>/dev/null; echo done)"

# --- system facts
r uname-s "$(uname -s 2>/dev/null)"
r uname-m "$(uname -m 2>/dev/null | sed 's/x86_64/ARCH/;s/aarch64/ARCH/')"
r uname-r "$(uname -r 2>/dev/null | grep -c '^[0-9]')"
r id-un "$(id -un 2>/dev/null)"
r getent "$(getent passwd root 2>/dev/null | cut -d: -f6,7)"
r proc-environ "$(tr '\0' '\n' </proc/self/environ | grep -c '=')"

# --- stream copy and encoding (shell-runs, relay, machine settings)
r base64-d "$(printf 'aGVsbG8gd29ybGQ=' | base64 -d)"
r base64-d-wrapped "$(printf 'aGVsbG8g\nd29ybGQ=\n' | base64 -d)"
r base64-d-heredoc "$(base64 -d <<'EOF_input' | cat
aGVsbG8g
d29ybGQ=
EOF_input
)"
r base64-d-pad "$(printf 'aGk' | base64 -d 2>&1 | od -An -c | tr -s ' ')"
r base64-enc "$(printf 'hello world' | base64)"
r cat-redirect "$(printf 'data' | cat > cr.part && chmod 0644 cr.part && mv -f cr.part cr && ls -l cr | cut -c1-10)"
r umask-022 "$( (umask 022; mkdir -p um1; : >um1/f; ls -ld um1 | cut -c1-10; ls -l um1/f | cut -c1-10) | tr '\n' ' ')"
r printf-fmt "$(printf '%s %s %s\n' PREFIX unpack 10)"
r od-c "$(printf 'a' | od -An -c | tr -s ' ')"
