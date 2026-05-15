#include "log_parser.hpp"
#include <iostream>

int main(int argc, char** argv) {
  if (argc < 3) {
    std::cout << "Usage: ./log_engine <log_file> <server_url>\n"
              << "Example: ./log_engine sample_logs.log http://localhost:5000/api/logs\n";
    return 1;
  }

  const std::string logFile   = argv[1];
  const std::string serverUrl = argv[2];
  const int topK = (argc >= 4) ? std::stoi(argv[3]) : 10;

  // Read & parse every line (all 8 formats + fallback)
  auto lines = readFile(logFile);
  if (lines.empty()) {
    std::cerr << "No lines found in: " << logFile << "\n";
    return 1;
  }

  std::vector<ParsedLog> parsed;
  parsed.reserve(lines.size());
  int fallback = 0;

  for (auto& line : lines) {
    ParsedLog entry;
    if (parseLogLine(line, entry)) {
      if (entry.formatMatched == "FALLBACK") ++fallback;
      parsed.push_back(entry);
    }
  }

  std::cout << "\n=== LogLytics C++ Engine ===\n"
            << "File        : " << logFile   << "\n"
            << "Lines read  : " << lines.size()  << "\n"
            << "Parsed OK   : " << parsed.size() << "\n"
            << "Fallback    : " << fallback << "\n\n";

  // Run all 6 DSA structures and build enriched payload
  auto payload = analyzeWithDSA(parsed, topK);

  // Print DSA summary to console
  auto& meta = payload["dsaMeta"];
  std::cout << "=== DSA Analysis ===\n"
            << "  [HashMap]  ERROR="   << meta["summary"]["ERROR"]
            << "  WARNING="            << meta["summary"]["WARNING"]
            << "  INFO="               << meta["summary"]["INFO"]   << "\n"
            << "  [Trie]     Words indexed : " << meta["trieWordCount"]      << "\n"
            << "  [CircBuf]  Recent window : " << meta["circularBufSize"]
            << " / "                           << meta["circularBufCap"]     << "\n"
            << "  [BinSearch]Timestamp idx : " << meta["timestampIndexSize"] << "\n"
            << "  [MinHeap]  Top-" << topK << " errors:\n";

  for (auto& e : meta["topErrors"])
    std::cout << "    x" << e["count"] << "  " << e["message"] << "\n";

  std::cout << "\n  [Formats detected]:\n";
  for (auto& [fmt, cnt] : meta["formatBreakdown"].items())
    std::cout << "    " << fmt << " : " << cnt << "\n";

  // Send to backend  POST /api/logs
  std::cout << "\nSending to " << serverUrl << " ...\n";
  if (!sendToServer(payload, serverUrl)) return 2;
  std::cout << "Done. " << parsed.size() << " logs sent.\n";
  return 0;
}