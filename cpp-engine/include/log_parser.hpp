#pragma once
#include <string>
#include <vector>
#include <nlohmann/json.hpp>

struct ParsedLog {
  std::string timestamp;
  std::string type;
  std::string message;
  std::string rawLine;
  std::string formatMatched;
};

std::vector<std::string> readFile(const std::string& path);
bool parseLogLine(const std::string& line, ParsedLog& out);
std::string classifyLog(const std::string& text);
std::string currentUTCTimestamp();
nlohmann::json convertToJSON(const std::vector<ParsedLog>& logs);
bool sendToServer(const nlohmann::json& payload, const std::string& url);
