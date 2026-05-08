#include "log_parser.hpp"
#include <curl/curl.h>
#include <algorithm>
#include <cctype>
#include <chrono>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <regex>
#include <sstream>
#include <unordered_map>

std::vector<std::string> readFile(const std::string& path) {
  std::ifstream file(path);
  std::vector<std::string> lines;
  std::string line;
  while (std::getline(file, line)) {
    if (!line.empty()) lines.push_back(line);
  }
  return lines;
}

std::string toUpper(std::string text) {
  std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) {
    return static_cast<char>(std::toupper(c));
  });
  return text;
}

std::string currentUTCTimestamp() {
  auto now = std::chrono::system_clock::now();
  std::time_t t = std::chrono::system_clock::to_time_t(now);
  std::tm tmUtc{};
#ifdef _WIN32
  gmtime_s(&tmUtc, &t);
#else
  gmtime_r(&t, &tmUtc);
#endif
  std::ostringstream oss;
  oss << std::put_time(&tmUtc, "%Y-%m-%dT%H:%M:%SZ");
  return oss.str();
}

std::string classifyLog(const std::string& text) {
  const std::string upper = toUpper(text);
  if (upper.find("ERROR") != std::string::npos || upper.find("ERR") != std::string::npos ||
      upper.find("FATAL") != std::string::npos || upper.find("CRITICAL") != std::string::npos ||
      upper.find("EXCEPTION") != std::string::npos || upper.find("FAIL") != std::string::npos) {
    return "ERROR";
  }
  if (upper.find("WARN") != std::string::npos || upper.find("WARNING") != std::string::npos ||
      upper.find("RETRY") != std::string::npos || upper.find("DEPRECATED") != std::string::npos) {
    return "WARNING";
  }
  return "INFO";
}

bool parseLogLine(const std::string& line, ParsedLog& out) {
  out.rawLine = line;
  out.formatMatched = "FALLBACK";

  // 1) JSON logs: {"timestamp":"...","level":"ERROR","message":"..."}
  if (!line.empty() && line.front() == '{' && line.back() == '}') {
    try {
      auto j = nlohmann::json::parse(line);
      const std::string timestamp = j.value("timestamp", j.value("time", j.value("ts", "")));
      const std::string level = j.value("level", j.value("severity", ""));
      const std::string message = j.value("message", j.value("msg", line));
      out.timestamp = timestamp.empty() ? currentUTCTimestamp() : timestamp;
      out.type = classifyLog(level.empty() ? message : level);
      out.message = message;
      out.formatMatched = "JSON_LINE";
      return true;
    } catch (...) {
      // Continue with regex patterns
    }
  }

  // 2) [timestamp] LEVEL - message
  static const std::regex bracketLevelDash(R"(^\[(.*?)\]\s+(INFO|WARNING|ERROR|WARN|DEBUG|TRACE|FATAL)\s+-\s+(.*)$)");
  // 3) timestamp LEVEL message
  static const std::regex isoLevelMsg(R"(^((?:\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})?))\s+([A-Za-z]+)\s+(.*)$)");
  // 4) LEVEL: message
  static const std::regex levelColonMsg(R"(^([A-Za-z]+)\s*:\s*(.*)$)");

  std::smatch m;
  if (std::regex_match(line, m, bracketLevelDash)) {
    out.timestamp = m[1];
    out.type = classifyLog(m[2]);
    out.message = m[3];
    out.formatMatched = "BRACKET_LEVEL_DASH";
    return true;
  }

  if (std::regex_match(line, m, isoLevelMsg)) {
    out.timestamp = m[1];
    out.type = classifyLog(m[2]);
    out.message = m[3];
    out.formatMatched = "ISO_LEVEL_MSG";
    return true;
  }

  if (std::regex_match(line, m, levelColonMsg)) {
    out.timestamp = currentUTCTimestamp();
    out.type = classifyLog(m[1]);
    out.message = m[2];
    out.formatMatched = "LEVEL_COLON_MSG";
    return true;
  }

  // 5) Fallback for any text line
  out.timestamp = currentUTCTimestamp();
  out.type = classifyLog(line);
  out.message = line;
  return true;
}

nlohmann::json convertToJSON(const std::vector<ParsedLog>& logs) {
  nlohmann::json output;
  output["logs"] = nlohmann::json::array();

  std::unordered_map<std::string, int> repeatErrors;
  for (const auto& log : logs) {
    output["logs"].push_back({
      {"timestamp", log.timestamp},
      {"type", log.type},
      {"message", log.message},
      {"rawLine", log.rawLine},
      {"formatMatched", log.formatMatched}
    });
    if (log.type == "ERROR") repeatErrors[log.message]++;
  }

  output["errorPatterns"] = nlohmann::json::array();
  for (const auto& [message, count] : repeatErrors) {
    if (count > 1) output["errorPatterns"].push_back({{"message", message}, {"count", count}});
  }

  return output;
}

bool sendToServer(const nlohmann::json& payload, const std::string& url) {
  CURL* curl = curl_easy_init();
  if (!curl) return false;

  struct curl_slist* headers = nullptr;
  headers = curl_slist_append(headers, "Content-Type: application/json");

  std::string payloadStr = payload.dump();
  curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
  curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payloadStr.c_str());

  CURLcode res = curl_easy_perform(curl);

  curl_slist_free_all(headers);
  curl_easy_cleanup(curl);

  if (res != CURLE_OK) {
    std::cerr << "sendToServer failed: " << curl_easy_strerror(res) << "\n";
    return false;
  }
  return true;
}
