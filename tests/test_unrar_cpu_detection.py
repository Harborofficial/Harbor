"""Exercise Intel macOS feature selection without compiler CPU-runtime helpers."""

import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src-tauri/vendor/unrar_sys/vendor/unrar/system.cpp"


class UnrarCpuDetectionTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == "darwin", "Requires macOS SDK")
    def test_intel_object_has_no_cpu_runtime_dependency(self):
        compiler = shutil.which("clang++")
        self.assertIsNotNone(compiler)
        with tempfile.TemporaryDirectory() as directory:
            obj = pathlib.Path(directory) / "system.o"
            for source in [SOURCE, SOURCE.with_name("rijndael.cpp")]:
                subprocess.run(
                    [compiler, "-arch", "x86_64", "-std=c++14", "-DRARDLL",
                     "-O2", "-c", str(source), "-o", str(obj)],
                    check=True,
                )
                symbols = subprocess.check_output(["nm", "-u", str(obj)], text=True)
                self.assertNotIn("cpu_model", symbols)
                self.assertNotIn("cpu_indicator", symbols)

    def test_feature_selection(self):
        compiler = shutil.which("clang++") or shutil.which("g++")
        if not compiler:
            self.skipTest("Requires clang++ or g++")
        source = SOURCE.read_text()
        branch = source.split(
            "#elif defined(__APPLE__) && defined(__x86_64__)", 1
        )[1].split("#elif defined(__GNUC__)", 1)[0]
        harness = r"""
#include <cassert>
enum SSE_VERSION {SSE_NONE,SSE_SSE,SSE_SSE2,SSE_SSSE3,SSE_SSE41,SSE_AVX2};
unsigned int features, legacy, avx2;
unsigned long long xcr0;
bool leaf1=true, leaf7=true;
int xcrReads=0;
bool __get_cpuid(unsigned int, unsigned int *a, unsigned int *b,
                 unsigned int *c, unsigned int *d) {
  *a=*b=0; *c=features; *d=legacy; return leaf1;
}
bool __get_cpuid_count(unsigned int, unsigned int, unsigned int *a,
                       unsigned int *b, unsigned int *c, unsigned int *d) {
  *a=*c=*d=0; *b=avx2; return leaf7;
}
unsigned long long GetXCR0() { ++xcrReads; return xcr0; }
SSE_VERSION detect() {
""" + branch + r"""
  return SSE_NONE;
}
int main() {
  assert(detect()==SSE_NONE);
  legacy=1u<<25; assert(detect()==SSE_SSE);
  legacy|=1u<<26; assert(detect()==SSE_SSE2);
  features=1u<<9; assert(detect()==SSE_SSSE3);
  features|=1u<<19; assert(detect()==SSE_SSE41);
  const unsigned int state=(1u<<26)|(1u<<27)|(1u<<28);
  features|=state; avx2=1u<<5; xcr0=6;
  assert(detect()==SSE_AVX2);
  leaf7=false; assert(detect()==SSE_SSE41); leaf7=true;
  avx2=0; assert(detect()==SSE_SSE41); avx2=1u<<5;
  for (unsigned long long value : {0ull,2ull,4ull}) {
    xcr0=value; assert(detect()==SSE_SSE41);
  }
  xcr0=6;
  for (unsigned int bit : {26u,27u,28u}) {
    features=(1u<<19)|(state & ~(1u<<bit));
    xcrReads=0; assert(detect()==SSE_SSE41); assert(xcrReads==0);
  }
  leaf1=false; xcrReads=0;
  assert(detect()==SSE_NONE); assert(xcrReads==0);
}
"""
        harness = "#include <initializer_list>\n" + harness
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory)
            cpp = path / "cpu.cpp"
            executable = path / "cpu-test"
            cpp.write_text(harness)
            subprocess.run(
                [compiler, "-std=c++14", str(cpp), "-o", str(executable)],
                check=True,
            )
            subprocess.run([str(executable)], check=True)


if __name__ == "__main__":
    unittest.main()
