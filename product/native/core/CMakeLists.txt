cmake_minimum_required(VERSION 3.21)
project(Flamoris2D.Core.Native LANGUAGES CXX)

if(WIN32)
  if(POLICY CMP0135)
    cmake_policy(SET CMP0135 NEW)
  endif()
  include(FetchContent)
  FetchContent_Declare(fl2d_icu
    URL https://github.com/unicode-org/icu/releases/download/release-78.3/icu4c-78.3-Win64-MSVC2022.zip
    URL_HASH SHA256=446b671f9437227daa79e221d4521d75793f9ecd65ac44c06e34dd848f201ac2)
  FetchContent_MakeAvailable(fl2d_icu)
  foreach(component uc in)
    add_library(fl2d_icu_${component} SHARED IMPORTED)
    set_target_properties(fl2d_icu_${component} PROPERTIES
      IMPORTED_IMPLIB "${fl2d_icu_SOURCE_DIR}/lib64/icu${component}.lib"
      IMPORTED_LOCATION "${fl2d_icu_SOURCE_DIR}/bin64/icu${component}78.dll"
      INTERFACE_INCLUDE_DIRECTORIES "${fl2d_icu_SOURCE_DIR}/include")
  endforeach()
  set(fl2d_icu_libraries fl2d_icu_uc fl2d_icu_in)
else()
  find_package(ICU 78.3 EXACT REQUIRED COMPONENTS uc i18n)
  set(fl2d_icu_libraries ICU::uc ICU::i18n)
endif()

add_library(Flamoris2D.Core.Native SHARED src/flamoris2d_core.cpp src/project_snapshot.cpp src/editor_session.cpp src/native_commands.cpp src/rig_hierarchy_commands.cpp src/temporal_commands.cpp src/transition_commands.cpp src/mesh_commands.cpp src/native_queries.cpp src/native_temporal_evaluation.cpp src/native_rig_evaluation.cpp)
target_compile_features(Flamoris2D.Core.Native PRIVATE cxx_std_17)
target_compile_definitions(Flamoris2D.Core.Native PRIVATE FL2D_CORE_BUILD)
target_include_directories(Flamoris2D.Core.Native PUBLIC include)
target_include_directories(Flamoris2D.Core.Native PRIVATE third_party/picojson)
target_link_libraries(Flamoris2D.Core.Native PRIVATE ${fl2d_icu_libraries})
if(WIN32)
  add_custom_command(TARGET Flamoris2D.Core.Native POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "${fl2d_icu_SOURCE_DIR}/bin64/icuuc78.dll"
      "${fl2d_icu_SOURCE_DIR}/bin64/icuin78.dll"
      "${fl2d_icu_SOURCE_DIR}/bin64/icudt78.dll"
      "$<TARGET_FILE_DIR:Flamoris2D.Core.Native>"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different "${fl2d_icu_SOURCE_DIR}/LICENSE"
      "$<TARGET_FILE_DIR:Flamoris2D.Core.Native>/ICU-LICENSE.txt")
endif()
if(MSVC)
  target_compile_options(Flamoris2D.Core.Native PRIVATE /W4 /WX)
else()
  target_compile_options(Flamoris2D.Core.Native PRIVATE -Wall -Wextra -Werror)
endif()

include(CTest)
if(BUILD_TESTING)
  add_executable(flamoris2d_core_tests tests/core_tests.cpp)
  target_compile_features(flamoris2d_core_tests PRIVATE cxx_std_17)
  target_include_directories(flamoris2d_core_tests PRIVATE third_party/picojson)
  target_compile_definitions(flamoris2d_core_tests PRIVATE FL2D_PROJECT_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/../tests/project-conformance.json")
  target_compile_definitions(flamoris2d_core_tests PRIVATE FL2D_SESSION_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/../tests/session-conformance.json")
  target_compile_definitions(flamoris2d_core_tests PRIVATE FL2D_RIG_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/../tests/rig-conformance.json")
  target_compile_definitions(flamoris2d_core_tests PRIVATE FL2D_HIERARCHY_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/../tests/hierarchy-conformance.json")
  target_compile_definitions(flamoris2d_core_tests PRIVATE FL2D_TEMPORAL_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/../tests/temporal-session-conformance.json")
  target_compile_definitions(flamoris2d_core_tests PRIVATE FL2D_TRANSITION_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/../tests/transition-session-conformance.json")
  target_compile_definitions(flamoris2d_core_tests PRIVATE FL2D_MESH_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/../tests/mesh-session-conformance.json")
  target_compile_definitions(flamoris2d_core_tests PRIVATE FL2D_SOURCE_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/../tests/source-session-conformance.json")
  target_compile_definitions(flamoris2d_core_tests PRIVATE FL2D_QUERY_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/../tests/query-conformance.json")
  target_link_libraries(flamoris2d_core_tests PRIVATE Flamoris2D.Core.Native ${fl2d_icu_libraries})
  add_test(NAME flamoris2d_core_tests COMMAND flamoris2d_core_tests)
endif()
