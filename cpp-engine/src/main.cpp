#include "log_parser.hpp"
#include <iostream>

int main(int argc, char** argv) {
  if (argc < 3) {
    std::cout << "Usage: ./log_engine <log_file> <server_url>\n";
    return 1;
  }

  std::string logFile = argv[1];
  std::string serverUrl = argv[2];

  auto lines = readFile(logFile);
  std::vector<ParsedLog> parsed;
  parsed.reserve(lines.size());

  int fallbackCount = 0;
  for (const auto& line : lines) {
    ParsedLog entry;
    if (parseLogLine(line, entry)) {
      if (entry.formatMatched == "FALLBACK") fallbackCount++;
      parsed.push_back(entry);
    }
  }

  auto payload = convertToJSON(parsed);
  std::cout << payload.dump(2) << "\n";
  std::cout << "Parsed lines: " << parsed.size() << ", fallback-parsed lines: " << fallbackCount << "\n";

  if (!sendToServer(payload, serverUrl)) return 2;

  std::cout << "Sent " << parsed.size() << " logs successfully.\n";
  return 0;
}
