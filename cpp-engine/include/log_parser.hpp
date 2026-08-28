#pragma once
#include <string>
#include <vector>
#include <unordered_map>
#include <queue>
#include <array>
#include <memory>
#include <nlohmann/json.hpp>

// ─────────────────────────────────────────────
// Parsed log entry
// ─────────────────────────────────────────────
struct ParsedLog {
  std::string timestamp;
  std::string type;        // INFO | WARNING | ERROR
  std::string message;
  std::string rawLine;
  std::string formatMatched;
};

// ═════════════════════════════════════════════
// DSA #1 — TRIE  (prefix search on messages)
// O(m) insert & search where m = word length
// ═════════════════════════════════════════════
struct TrieNode {
  std::array<std::unique_ptr<TrieNode>, 128> children{};
  std::vector<int> logIndices;
  bool isEnd = false;
};

class Trie {
public:
  Trie() : root(std::make_unique<TrieNode>()) {}
  void insert(const std::string& word, int logIdx);
  std::vector<int> search(const std::string& prefix) const;
  int wordCount() const { return totalWords; }
private:
  std::unique_ptr<TrieNode> root;
  int totalWords = 0;
  const TrieNode* findNode(const std::string& prefix) const;
  void collectIndices(const TrieNode* node, std::vector<int>& out) const;
};

// ═════════════════════════════════════════════
// DSA #2 — MIN-HEAP  (Top-K frequent errors)
// Push O(log K), extract-all O(K log K)
// ═════════════════════════════════════════════
struct FreqEntry {
  int count;
  std::string message;
  bool operator>(const FreqEntry& o) const { return count > o.count; }
  bool operator<(const FreqEntry& o) const { return count < o.count; }
};

class MinHeap {
public:
  explicit MinHeap(int k) : K(k) {}
  void push(const FreqEntry& entry);
  std::vector<FreqEntry> topK() const;
  int size() const { return (int)heap.size(); }
private:
  int K;
  std::priority_queue<FreqEntry,
    std::vector<FreqEntry>, std::greater<FreqEntry>> heap;
};

// ═════════════════════════════════════════════
// DSA #3 — HASH MAP  (O(1) frequency counting)
// ═════════════════════════════════════════════
class FrequencyMap {
public:
  void increment(const std::string& key);
  int  get(const std::string& key) const;
  std::vector<std::pair<std::string,int>> topN(int n) const;
  std::unordered_map<std::string,int>& raw() { return map; }
  const std::unordered_map<std::string,int>& raw() const { return map; }
  int totalKeys() const { return (int)map.size(); }
private:
  std::unordered_map<std::string,int> map;
};

// ═════════════════════════════════════════════
// DSA #4 — CIRCULAR BUFFER  (live log stream)
// Fixed-size ring; oldest entry overwritten
// Push O(1), snapshot O(n)
// ═════════════════════════════════════════════
class CircularBuffer {
public:
  explicit CircularBuffer(int cap) : capacity(cap), buf(cap) {}
  void push(const ParsedLog& log);
  std::vector<ParsedLog> snapshot() const;
  int size()        const { return count; }
  int getCapacity() const { return capacity; }
private:
  int capacity, head = 0, count = 0;
  std::vector<ParsedLog> buf;
};

// ═════════════════════════════════════════════
// DSA #5 — KMP STRING SEARCH  (O(n+m))
// Pattern matching without regex overhead
// ═════════════════════════════════════════════
class KMP {
public:
  explicit KMP(const std::string& pattern);
  bool contains(const std::string& text) const;
  std::vector<int> allMatches(const std::string& text) const;
private:
  std::string pat;
  std::vector<int> lps;
  void buildLPS();
};

// ═════════════════════════════════════════════
// DSA #6 — BINARY SEARCH on sorted timestamps
// ISO 8601 lex order == chronological order
// Range query O(log n)
// ═════════════════════════════════════════════
class TimestampIndex {
public:
  void build(const std::vector<ParsedLog>& logs);
  std::pair<int,int> rangeQuery(const std::string& start,
                                const std::string& end) const;
  int size() const { return (int)timestamps.size(); }
private:
  std::vector<std::string> timestamps;
  int lowerBound(const std::string& t) const;
  int upperBound(const std::string& t) const;
};

// ─────────────────────────────────────────────
// Core parsing helpers
// ─────────────────────────────────────────────
std::vector<std::string> readFile(const std::string& path);
bool        parseLogLine(const std::string& line, ParsedLog& out);
std::string classifyLog(const std::string& text);
std::string currentUTCTimestamp();
nlohmann::json convertToJSON(const std::vector<ParsedLog>& logs);
bool        sendToServer(const nlohmann::json& payload,
                         const std::string& url);

// Full DSA analysis → enriched JSON sent to /api/logs
nlohmann::json analyzeWithDSA(const std::vector<ParsedLog>& logs,
                               int topK = 10);