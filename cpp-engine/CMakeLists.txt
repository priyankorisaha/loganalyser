cmake_minimum_required(VERSION 3.15)
project(log_analyzer_engine)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

include(FetchContent)
FetchContent_Declare(
  nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.11.3
)
FetchContent_MakeAvailable(nlohmann_json)

find_package(CURL REQUIRED)

add_executable(log_engine src/main.cpp src/log_parser.cpp)
target_include_directories(log_engine PRIVATE include)
target_link_libraries(log_engine PRIVATE CURL::libcurl nlohmann_json::nlohmann_json)
