#include "log_parser.hpp"
#include <curl/curl.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <numeric>
#include <regex>
#include <set>
#include <sstream>

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════
static std::string toUpper(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(),
    [](unsigned char c){ return (char)std::toupper(c); });
  return s;
}

static std::string toLower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(),
    [](unsigned char c){ return (char)std::tolower(c); });
  return s;
}

std::string currentUTCTimestamp() {
  auto now = std::chrono::system_clock::now();
  std::time_t t = std::chrono::system_clock::to_time_t(now);
  std::tm tm{};
#ifdef _WIN32
  gmtime_s(&tm, &t);
#else
  gmtime_r(&t, &tm);
#endif
  std::ostringstream oss;
  oss << std::put_time(&tm, "%Y-%m-%dT%H:%M:%SZ");
  return oss.str();
}

std::vector<std::string> readFile(const std::string& path) {
  std::ifstream f(path);
  std::vector<std::string> lines;
  std::string line;
  while (std::getline(f, line))
    if (!line.empty()) lines.push_back(line);
  return lines;
}

// ══════════════════════════════════════════════
// LOG CLASSIFICATION
// ══════════════════════════════════════════════
std::string classifyLog(const std::string& text) {
  const std::string up = toUpper(text);
  for (auto& kw : {"ERROR","ERR","FATAL","CRITICAL","EXCEPTION","FAIL","SEVERE"})
    if (up.find(kw) != std::string::npos) return "ERROR";
  for (auto& kw : {"WARN","WARNING","RETRY","DEPRECATED","NOTICE"})
    if (up.find(kw) != std::string::npos) return "WARNING";
  return "INFO";
}

// ══════════════════════════════════════════════
// MULTI-FORMAT LOG PARSER
// Supports 8 formats + universal fallback
// ══════════════════════════════════════════════
bool parseLogLine(const std::string& line, ParsedLog& out) {
  out.rawLine = line;
  out.formatMatched = "FALLBACK";

  // 1) JSON  {"timestamp":"…","level":"…","message":"…"}
  if (!line.empty() && line.front() == '{') {
    try {
      auto j = nlohmann::json::parse(line);
      auto ts  = j.value("timestamp", j.value("time", j.value("ts", "")));
      auto lvl = j.value("level", j.value("severity", j.value("lvl", "")));
      auto msg = j.value("message", j.value("msg", line));
      out.timestamp    = ts.empty() ? currentUTCTimestamp() : ts;
      out.type         = classifyLog(lvl.empty() ? msg : lvl);
      out.message      = msg;
      out.formatMatched = "JSON_LINE";
      return true;
    } catch (...) {}
  }

  std::smatch m;

  // 2) [timestamp] LEVEL - message
  static const std::regex rBracket(
    R"(^\[(.*?)\]\s+(INFO|WARNING|ERROR|WARN|DEBUG|TRACE|FATAL)\s+-\s+(.+)$)");
  if (std::regex_match(line, m, rBracket)) {
    out.timestamp = m[1]; out.type = classifyLog(m[2]); out.message = m[3];
    out.formatMatched = "BRACKET_LEVEL_DASH"; return true;
  }

  // 3) ISO timestamp LEVEL message
  //    2024-01-15T10:30:00Z ERROR Something happened
  static const std::regex rISO(
    R"(^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})?)\s+([A-Za-z]+)\s+(.+)$)");
  if (std::regex_match(line, m, rISO)) {
    out.timestamp = m[1]; out.type = classifyLog(m[2]); out.message = m[3];
    out.formatMatched = "ISO_LEVEL_MSG"; return true;
  }

  // 4) LEVEL: message
  static const std::regex rLevelColon(R"(^([A-Za-z]+)\s*:\s*(.+)$)");
  if (std::regex_match(line, m, rLevelColon)) {
    out.timestamp = currentUTCTimestamp();
    out.type      = classifyLog(m[1]); out.message = m[2];
    out.formatMatched = "LEVEL_COLON_MSG"; return true;
  }

  // 5) Apache/Nginx access log
  //    127.0.0.1 - - [15/Jan/2024:10:30:00 +0000] "GET /api HTTP/1.1" 500 1234
  static const std::regex rApache(
    R"REGEX(^([\S]+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([^\"]+)"\s+(\d{3})\s+\S+.*)REGEX");
  if (std::regex_match(line, m, rApache)) {
    int code = std::stoi(m[4].str());
    out.timestamp = m[2];
    out.type      = code >= 500 ? "ERROR" : code >= 400 ? "WARNING" : "INFO";
    out.message   = m[3].str() + " [HTTP " + m[4].str() + "]";
    out.formatMatched = "APACHE_ACCESS"; return true;
  }

  // 6) Syslog  May  6 10:30:00 hostname process[pid]: message
  static const std::regex rSyslog(
    R"(^([A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+\S+\s+\S+:\s+(.+)$)");
  if (std::regex_match(line, m, rSyslog)) {
    out.timestamp = m[1]; out.type = classifyLog(m[2]); out.message = m[2];
    out.formatMatched = "SYSLOG"; return true;
  }

  // 7) Log4j / Logback style
  //    2024-01-15 10:30:00,123 ERROR [thread] class - message
  static const std::regex rLog4j(
    R"(^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]?\d*)\s+(ERROR|WARN|INFO|DEBUG|TRACE|FATAL)\s+.*?-\s+(.+)$)");
  if (std::regex_match(line, m, rLog4j)) {
    out.timestamp = m[1]; out.type = classifyLog(m[2]); out.message = m[3];
    out.formatMatched = "LOG4J"; return true;
  }

  // 8) Windows Event log style
  //    Error   1/15/2024 10:30:00 AM  Application  100  message
  static const std::regex rWin(
    R"(^(Error|Warning|Information)\s+(\d+/\d+/\d{4}\s+\S+\s+[AP]M)\s+\S+\s+\d+\s+(.+)$)");
  if (std::regex_match(line, m, rWin)) {
    out.timestamp = m[2]; out.type = classifyLog(m[1]); out.message = m[3];
    out.formatMatched = "WINDOWS_EVENT"; return true;
  }

  // FALLBACK — classify entire line
  out.timestamp = currentUTCTimestamp();
  out.type      = classifyLog(line);
  out.message   = line;
  return true;
}

// ══════════════════════════════════════════════
// DSA #1  TRIE
// ══════════════════════════════════════════════
void Trie::insert(const std::string& word, int logIdx) {
  if (word.empty()) return;
  TrieNode* cur = root.get();
  for (unsigned char c : word) {
    int idx = c < 128 ? (int)c : 0;
    if (!cur->children[idx])
      cur->children[idx] = std::make_unique<TrieNode>();
    cur = cur->children[idx].get();
    cur->logIndices.push_back(logIdx);
  }
  if (!cur->isEnd) { cur->isEnd = true; ++totalWords; }
}

const TrieNode* Trie::findNode(const std::string& prefix) const {
  const TrieNode* cur = root.get();
  for (unsigned char c : prefix) {
    int idx = c < 128 ? (int)c : 0;
    if (!cur->children[idx]) return nullptr;
    cur = cur->children[idx].get();
  }
  return cur;
}

void Trie::collectIndices(const TrieNode* node, std::vector<int>& out) const {
  for (int i : node->logIndices) out.push_back(i);
}

std::vector<int> Trie::search(const std::string& prefix) const {
  const TrieNode* node = findNode(toLower(prefix));
  if (!node) return {};
  std::vector<int> res;
  collectIndices(node, res);
  // deduplicate
  std::sort(res.begin(), res.end());
  res.erase(std::unique(res.begin(), res.end()), res.end());
  return res;
}

// ══════════════════════════════════════════════
// DSA #2  MIN-HEAP
// ══════════════════════════════════════════════
void MinHeap::push(const FreqEntry& e) {
  heap.push(e);
  if ((int)heap.size() > K) heap.pop(); // evict smallest
}

std::vector<FreqEntry> MinHeap::topK() const {
  auto copy = heap;
  std::vector<FreqEntry> res;
  while (!copy.empty()) { res.push_back(copy.top()); copy.pop(); }
  std::sort(res.begin(), res.end(), [](auto& a, auto& b){ return a.count > b.count; });
  return res;
}

// ══════════════════════════════════════════════
// DSA #3  HASH MAP
// ══════════════════════════════════════════════
void FrequencyMap::increment(const std::string& key) { ++map[key]; }
int  FrequencyMap::get(const std::string& key) const {
  auto it = map.find(key); return it == map.end() ? 0 : it->second;
}
std::vector<std::pair<std::string,int>> FrequencyMap::topN(int n) const {
  std::vector<std::pair<std::string,int>> v(map.begin(), map.end());
  std::partial_sort(v.begin(),
    v.begin() + std::min(n,(int)v.size()), v.end(),
    [](auto& a, auto& b){ return a.second > b.second; });
  if ((int)v.size() > n) v.resize(n);
  return v;
}

// ══════════════════════════════════════════════
// DSA #4  CIRCULAR BUFFER
// ══════════════════════════════════════════════
void CircularBuffer::push(const ParsedLog& log) {
  buf[head] = log;
  head = (head + 1) % capacity;
  if (count < capacity) ++count;
}

std::vector<ParsedLog> CircularBuffer::snapshot() const {
  std::vector<ParsedLog> res;
  res.reserve(count);
  int start = (count < capacity) ? 0 : head;
  for (int i = 0; i < count; ++i)
    res.push_back(buf[(start + i) % capacity]);
  return res;
}

// ══════════════════════════════════════════════
// DSA #5  KMP
// ══════════════════════════════════════════════
KMP::KMP(const std::string& pattern) : pat(toLower(pattern)) { buildLPS(); }

void KMP::buildLPS() {
  int m = (int)pat.size();
  lps.assign(m, 0);
  int len = 0, i = 1;
  while (i < m) {
    if (pat[i] == pat[len]) { lps[i++] = ++len; }
    else if (len) len = lps[len-1];
    else lps[i++] = 0;
  }
}

std::vector<int> KMP::allMatches(const std::string& text) const {
  std::string t = toLower(text);
  std::vector<int> res;
  int n = (int)t.size(), m = (int)pat.size(), i = 0, j = 0;
  while (i < n) {
    if (t[i] == pat[j]) { ++i; ++j; }
    if (j == m) { res.push_back(i - j); j = lps[j-1]; }
    else if (i < n && t[i] != pat[j]) { j ? j = lps[j-1] : ++i; }
  }
  return res;
}

bool KMP::contains(const std::string& text) const {
  return !allMatches(text).empty();
}

// ══════════════════════════════════════════════
// DSA #6  BINARY SEARCH on timestamps
// ══════════════════════════════════════════════
void TimestampIndex::build(const std::vector<ParsedLog>& logs) {
  timestamps.clear();
  timestamps.reserve(logs.size());
  for (auto& l : logs) timestamps.push_back(l.timestamp);
  // already sorted by caller; if not, sort here
  std::sort(timestamps.begin(), timestamps.end());
}

int TimestampIndex::lowerBound(const std::string& t) const {
  int lo = 0, hi = (int)timestamps.size();
  while (lo < hi) {
    int mid = (lo+hi)/2;
    if (timestamps[mid] < t) lo = mid+1; else hi = mid;
  }
  return lo;
}

int TimestampIndex::upperBound(const std::string& t) const {
  int lo = 0, hi = (int)timestamps.size();
  while (lo < hi) {
    int mid = (lo+hi)/2;
    if (timestamps[mid] <= t) lo = mid+1; else hi = mid;
  }
  return lo;
}

std::pair<int,int> TimestampIndex::rangeQuery(
    const std::string& start, const std::string& end) const {
  return { lowerBound(start), upperBound(end) };
}

// ══════════════════════════════════════════════
// convertToJSON — standard payload for /api/logs
// ══════════════════════════════════════════════
nlohmann::json convertToJSON(const std::vector<ParsedLog>& logs) {
  nlohmann::json out;
  out["logs"] = nlohmann::json::array();
  for (auto& l : logs)
    out["logs"].push_back({
      {"timestamp",    l.timestamp},
      {"type",         l.type},
      {"message",      l.message},
      {"rawLine",      l.rawLine},
      {"formatMatched",l.formatMatched}
    });
  return out;
}

// ══════════════════════════════════════════════
// analyzeWithDSA — full enriched JSON output
// Uses all 6 DSA structures; result is printed
// to stdout AND sent to backend.
// ══════════════════════════════════════════════
nlohmann::json analyzeWithDSA(const std::vector<ParsedLog>& logs, int topK) {
  // ── DSA #3: frequency maps ──────────────────
  FrequencyMap typeFreq, msgFreq, fmtFreq;
  for (auto& l : logs) {
    typeFreq.increment(l.type);
    msgFreq.increment(l.message);
    fmtFreq.increment(l.formatMatched);
  }

  // ── DSA #2: min-heap top-K errors ───────────
  MinHeap heap(topK);
  for (auto& [msg, cnt] : msgFreq.raw())
    heap.push({cnt, msg});
  auto topErrors = heap.topK();

  // ── DSA #1: trie on all message words ───────
  Trie trie;
  for (int i = 0; i < (int)logs.size(); ++i) {
    std::istringstream iss(toLower(logs[i].message));
    std::string word;
    while (iss >> word) trie.insert(word, i);
  }

  // ── DSA #4: circular buffer (last 100) ──────
  CircularBuffer cbuf(100);
  for (auto& l : logs) cbuf.push(l);
  auto recent = cbuf.snapshot();

  // ── DSA #6: timestamp binary search index ───
  TimestampIndex tsIdx;
  auto sorted = logs;
  std::sort(sorted.begin(), sorted.end(),
    [](auto& a, auto& b){ return a.timestamp < b.timestamp; });
  tsIdx.build(sorted);

  // ── Build output JSON ────────────────────────
  nlohmann::json j;

  // Standard payload
  j["logs"] = nlohmann::json::array();
  for (auto& l : logs)
    j["logs"].push_back({
      {"timestamp",    l.timestamp},
      {"type",         l.type},
      {"message",      l.message},
      {"rawLine",      l.rawLine},
      {"formatMatched",l.formatMatched}
    });

  // DSA metadata (shown in Reports/Alerts UI)
  j["dsaMeta"]["summary"] = {
    {"ERROR",   typeFreq.get("ERROR")},
    {"WARNING", typeFreq.get("WARNING")},
    {"INFO",    typeFreq.get("INFO")},
    {"total",   (int)logs.size()}
  };

  j["dsaMeta"]["topErrors"] = nlohmann::json::array();
  for (auto& e : topErrors)
    j["dsaMeta"]["topErrors"].push_back({{"message",e.message},{"count",e.count}});

  j["dsaMeta"]["formatBreakdown"] = nlohmann::json::object();
  for (auto& [fmt, cnt] : fmtFreq.raw())
    j["dsaMeta"]["formatBreakdown"][fmt] = cnt;

  j["dsaMeta"]["trieWordCount"]     = trie.wordCount();
  j["dsaMeta"]["circularBufSize"]   = cbuf.size();
  j["dsaMeta"]["circularBufCap"]    = cbuf.getCapacity();
  j["dsaMeta"]["timestampIndexSize"]= tsIdx.size();

  j["dsaMeta"]["recentLogs"] = nlohmann::json::array();
  for (auto& l : recent)
    j["dsaMeta"]["recentLogs"].push_back({
      {"timestamp",l.timestamp},{"type",l.type},{"message",l.message}
    });

  return j;
}

// ══════════════════════════════════════════════
// sendToServer — HTTP POST via libcurl
// ══════════════════════════════════════════════
bool sendToServer(const nlohmann::json& payload, const std::string& url) {
  CURL* curl = curl_easy_init();
  if (!curl) return false;
  auto* hdrs = curl_slist_append(nullptr, "Content-Type: application/json");
  std::string body = payload.dump();
  curl_easy_setopt(curl, CURLOPT_URL,       url.c_str());
  curl_easy_setopt(curl, CURLOPT_HTTPHEADER, hdrs);
  curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
  CURLcode rc = curl_easy_perform(curl);
  curl_slist_free_all(hdrs);
  curl_easy_cleanup(curl);
  if (rc != CURLE_OK)
    std::cerr << "sendToServer: " << curl_easy_strerror(rc) << "\n";
  return rc == CURLE_OK;
}

