#include "log_parser.hpp"
#include <iostream>

int main(int argc, char** argv) {
  if (argc < 3) {
    std::cout << "Usage:\n"
              << "  Normal:  ./log_engine <log_file> <server_url> [topK]\n"
              << "  Analyze: ./log_engine --analyze-only <log_file> [topK]\n";
    return 1;
  }

  bool analyzeOnly = false;
  std::string logFile;
  std::string serverUrl;
  int topK = 10;

  if (std::string(argv[1]) == "--analyze-only") {
    analyzeOnly = true;
    logFile = argv[2];
    if (argc >= 4) {
      try {
        topK = std::stoi(argv[3]);
      } catch (...) {
        topK = 10;
      }
    }
  } else {
    logFile = argv[1];
    serverUrl = argv[2];
    if (argc >= 4) {
      try {
        topK = std::stoi(argv[3]);
      } catch (...) {
        topK = 10;
      }
    }
  }

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

  if (analyzeOnly) {
    std::cerr << "\n=== LogLytics C++ Engine ===\n"
              << "File        : " << logFile   << "\n"
              << "Lines read  : " << lines.size()  << "\n"
              << "Parsed OK   : " << parsed.size() << "\n"
              << "Fallback    : " << fallback << "\n\n";
  } else {
    std::cout << "\n=== LogLytics C++ Engine ===\n"
              << "File        : " << logFile   << "\n"
              << "Lines read  : " << lines.size()  << "\n"
              << "Parsed OK   : " << parsed.size() << "\n"
              << "Fallback    : " << fallback << "\n\n";
  }

  // Run all 6 DSA structures and build enriched payload
  auto payload = analyzeWithDSA(parsed, topK);

  // Print DSA summary to console
  auto& meta = payload["dsaMeta"];
  if (analyzeOnly) {
    std::cerr << "=== DSA Analysis ===\n"
              << "  [HashMap]  ERROR="   << meta["summary"]["ERROR"]
              << "  WARNING="            << meta["summary"]["WARNING"]
              << "  INFO="               << meta["summary"]["INFO"]   << "\n"
              << "  [Trie]     Words indexed : " << meta["trieWordCount"]      << "\n"
              << "  [CircBuf]  Recent window : " << meta["circularBufSize"]
              << " / "                           << meta["circularBufCap"]     << "\n"
              << "  [BinSearch]Timestamp idx : " << meta["timestampIndexSize"] << "\n"
              << "  [MinHeap]  Top-" << topK << " errors:\n";

    for (auto& e : meta["topErrors"])
      std::cerr << "    x" << e["count"] << "  " << e["message"] << "\n";

    std::cerr << "\n  [Formats detected]:\n";
    for (auto& [fmt, cnt] : meta["formatBreakdown"].items())
      std::cerr << "    " << fmt << " : " << cnt << "\n";

    // Print ONLY the resulting dsaMeta JSON to stdout
    std::cout << meta.dump() << std::endl;
  } else {
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
  }
  return 0;
}