# C++ Log Engine

Dependencies:
- libcurl
- nlohmann/json single header available in include path (install package `nlohmann-json3-dev` on Debian/Ubuntu)

Build:

```bash
mkdir -p build && cd build
cmake ..
cmake --build .
```

Run:

```bash
./log_engine ../sample_logs/app.log http://localhost:5000/api/logs
```
