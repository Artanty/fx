0x14013e970: mov qword ptr [rsp + 0x10], rbx
0x14013e975: mov qword ptr [rsp + 0x18], rsi
0x14013e97a: mov qword ptr [rsp + 0x20], rdi
0x14013e97f: push rbp
0x14013e980: push r12
0x14013e982: push r13
0x14013e984: push r14
0x14013e986: push r15
0x14013e988: lea rbp, [rsp - 0x37]
0x14013e98d: sub rsp, 0xc0
0x14013e994: mov r15, r8
0x14013e997: mov r13, rdx
0x14013e99a: cmp byte ptr [rcx + 0xe8], 0
0x14013e9a1: je 0x14013ec71
0x14013e9a7: cmp dword ptr [rdx + 0x30], 0x64
0x14013e9ab: jbe 0x14013ec71
0x14013e9b1: lea rsi, [rip + 0x7c0150]   ; -> 0x1408feb08
0x14013e9b8: mov qword ptr [rbp - 0x49], rsi
0x14013e9bc: lea rbx, [rip + 0x7bc7e5]   ; -> 0x1408fb1a8
0x14013e9c3: mov rdx, rbx
0x14013e9c6: lea rcx, [rbp - 0x41]
0x14013e9ca: call 0x1401e0420   [CALL]
0x14013e9cf: mov rax, rbx
0x14013e9d2: mov edi, 0x7ffffffe
0x14013e9d7: mov ecx, edi
0x14013e9d9: nop dword ptr [rax]
0x14013e9e0: movzx edx, byte ptr [rax]
0x14013e9e3: test dl, dl
0x14013e9e5: jle 0x14013e9f1
0x14013e9e7: inc rax
0x14013e9ea: sub ecx, 1
0x14013e9ed: jns 0x14013e9e0
0x14013e9ef: jmp 0x14013ea05
0x14013e9f1: je 0x14013ea05
0x14013e9f3: mov edx, 0x13b
0x14013e9f8: lea rcx, [rip + 0x6d2db1]   ; "C:\Jenkins\workspace\audio-apps\h90control\H90\AppCommon\juce-modules\modules\juce_core\text/juce_String.cpp"
0x14013e9ff: call 0x1404861a0   [CALL]
0x14013ea04: nop 
0x14013ea05: lea rax, [rip + 0x7bff1c]   ; -> 0x1408fe928
0x14013ea0c: mov qword ptr [rbp - 0x49], rax
0x14013ea10: lea rax, [rbp - 0x31]
0x14013ea14: mov qword ptr [rbp - 0x39], rax
0x14013ea18: xor r12d, r12d
0x14013ea1b: mov qword ptr [rbp - 0x31], r12
0x14013ea1f: mov qword ptr [rbp - 0x29], r12
0x14013ea23: mov qword ptr [rbp - 0x21], r12
0x14013ea27: mov qword ptr [rbp - 0x19], r12
0x14013ea2b: mov qword ptr [rbp - 0x11], r12
0x14013ea2f: mov qword ptr [rbp - 9], r12
0x14013ea33: xor ecx, ecx
0x14013ea35: call 0x1402ec0f4   [CALL]
0x14013ea3a: mov ecx, 0x100
0x14013ea3f: call 0x1402ec108   [CALL]
0x14013ea44: mov qword ptr [rbp - 0x31], rax
0x14013ea48: test rax, rax
0x14013ea4b: je 0x14013ecea
0x14013ea51: mov qword ptr [rbp - 0x29], 0x100
0x14013ea59: mov qword ptr [rbp + 7], rsi
0x14013ea5d: mov rdx, rbx
0x14013ea60: lea rcx, [rbp + 0xf]
0x14013ea64: call 0x1401e0420   [CALL]
0x14013ea69: nop dword ptr [rax]
0x14013ea70: movzx eax, byte ptr [rbx]
0x14013ea73: test al, al
0x14013ea75: jle 0x14013ea81
0x14013ea77: inc rbx
0x14013ea7a: sub edi, 1
0x14013ea7d: jns 0x14013ea70
0x14013ea7f: jmp 0x14013ea95
0x14013ea81: je 0x14013ea95
0x14013ea83: mov edx, 0x13b
0x14013ea88: lea rcx, [rip + 0x6d2d21]   ; "C:\Jenkins\workspace\audio-apps\h90control\H90\AppCommon\juce-modules\modules\juce_core\text/juce_String.cpp"
0x14013ea8f: call 0x1404861a0   [CALL]
0x14013ea94: nop 
0x14013ea95: lea rax, [rip + 0x7c3d24]   ; -> 0x1409027c0
0x14013ea9c: mov qword ptr [rbp + 7], rax
0x14013eaa0: lea rax, [rbp - 0x49]
0x14013eaa4: mov qword ptr [rbp + 0x17], rax
0x14013eaa8: mov byte ptr [rbp + 0x1f], 0
0x14013eaac: mov ecx, 0x8060
0x14013eab1: call 0x1402e5500   [CALL]
0x14013eab6: mov rbx, rax
0x14013eab9: mov qword ptr [rbp + 0x67], rax
0x14013eabd: mov esi, 0xffffffff
0x14013eac2: mov dword ptr [rax + 0x58], esi
0x14013eac5: mov word ptr [rax + 0x5c], 1
0x14013eacb: mov byte ptr [rax + 0x5e], 0
0x14013eacf: xorps xmm0, xmm0
0x14013ead2: xor eax, eax
0x14013ead4: movups xmmword ptr [rbx], xmm0
0x14013ead7: movups xmmword ptr [rbx + 0x10], xmm0
0x14013eadb: movups xmmword ptr [rbx + 0x20], xmm0
0x14013eadf: movups xmmword ptr [rbx + 0x30], xmm0
0x14013eae3: movups xmmword ptr [rbx + 0x40], xmm0
0x14013eae7: mov qword ptr [rbx + 0x50], rax
0x14013eaeb: lea rax, [rip + 0x7bcc7e]   ; "1.2.3"
0x14013eaf2: mov qword ptr [rsp + 0x30], rax
0x14013eaf7: mov dword ptr [rsp + 0x28], r12d
0x14013eafc: mov dword ptr [rsp + 0x20], 8
0x14013eb04: mov r9d, 0xf
0x14013eb0a: mov r8d, 8
0x14013eb10: mov edx, dword ptr [rbx + 0x58]
0x14013eb13: mov rcx, rbx
0x14013eb16: call 0x1404515f0   [CALL]
0x14013eb1b: test eax, eax
0x14013eb1d: sete al
0x14013eb20: mov byte ptr [rbx + 0x5d], al
0x14013eb23: mov qword ptr [rbp + 0x27], rbx
0x14013eb27: mov r14d, dword ptr [r13 + 0x30]
0x14013eb2b: mov rdi, qword ptr [r13 + 0x40]
0x14013eb2f: test rdi, rdi
0x14013eb32: jne 0x14013eb45
0x14013eb34: mov edx, 0x8d
0x14013eb39: lea rcx, [rip + 0x6d5b70]   ; -> 0x1408146b0
0x14013eb40: call 0x1404861a0   [CALL]
0x14013eb45: lea r9, [rbp - 0x49]
0x14013eb49: mov r8, r14
0x14013eb4c: mov rdx, rdi
0x14013eb4f: mov rcx, rbx
0x14013eb52: call 0x1401d7440   [CALL]
0x14013eb57: lea rdx, [rbp - 0x49]
0x14013eb5b: mov rcx, rbx
0x14013eb5e: call 0x1401d75f0   [CALL]
0x14013eb63: mov rax, qword ptr [rbp - 0x49]
0x14013eb67: lea rcx, [rbp - 0x49]
0x14013eb6b: call qword ptr [rax + 8]   [CALL]
0x14013eb6e: mov rdx, qword ptr [rbp - 0x11]
0x14013eb72: mov rax, qword ptr [rbp - 0x39]
0x14013eb76: test rax, rax
0x14013eb79: jne 0x14013eb81
0x14013eb7b: mov r8, qword ptr [rbp - 0x21]
0x14013eb7f: jmp 0x14013eb95
0x14013eb81: cmp qword ptr [rax + 8], rdx
0x14013eb85: jbe 0x14013eb92
0x14013eb87: mov rax, qword ptr [rax]
0x14013eb8a: mov byte ptr [rax + rdx], 0
0x14013eb8e: mov rax, qword ptr [rbp - 0x39]
0x14013eb92: mov r8, qword ptr [rax]
0x14013eb95: or byte ptr [r15 + 4], 2
0x14013eb9a: lea rcx, [r15 + 8]
0x14013eb9e: mov rax, qword ptr [rcx]
0x14013eba1: cmp rax, qword ptr [rcx + 8]
0x14013eba5: je 0x14013ebab
0x14013eba7: mov qword ptr [rcx + 8], rax
0x14013ebab: movsxd r9, edx
0x14013ebae: mov rdx, rax
0x14013ebb1: call 0x14014f2c0   [CALL]
0x14013ebb6: nop 
0x14013ebb7: lea rcx, [rbp + 7]
0x14013ebbb: call 0x140481ff0   [CALL]
0x14013ebc0: nop 
0x14013ebc1: lea rax, [rip + 0x7bfd60]   ; -> 0x1408fe928
0x14013ebc8: mov qword ptr [rbp - 0x49], rax
0x14013ebcc: lea rax, [rbp - 0x31]
0x14013ebd0: mov rbx, qword ptr [rbp - 0x39]
0x14013ebd4: cmp rbx, rax
0x14013ebd7: je 0x14013ec36
0x14013ebd9: test rbx, rbx
0x14013ebdc: je 0x14013ec36
0x14013ebde: mov rdi, qword ptr [rbp - 0x11]
0x14013ebe2: cmp qword ptr [rbx + 8], rdi
0x14013ebe6: je 0x14013ec36
0x14013ebe8: mov rcx, qword ptr [rbx]
0x14013ebeb: test rdi, rdi
0x14013ebee: jne 0x14013ebfe
0x14013ebf0: call 0x1402ec0f4   [CALL]
0x14013ebf5: mov qword ptr [rbx], r12
0x14013ebf8: mov qword ptr [rbx + 8], r12
0x14013ebfc: jmp 0x14013ec36
0x14013ebfe: test rcx, rcx
0x14013ec01: je 0x14013ec19
0x14013ec03: mov rdx, rdi
0x14013ec06: call 0x1402ec0ec   [CALL]
0x14013ec0b: mov qword ptr [rbx], rax
0x14013ec0e: test rax, rax
0x14013ec11: je 0x14013ecd0
0x14013ec17: jmp 0x14013ec32
0x14013ec19: call 0x1402ec0f4   [CALL]
0x14013ec1e: mov rcx, rdi
0x14013ec21: call 0x1402ec108   [CALL]
0x14013ec26: mov qword ptr [rbx], rax
0x14013ec29: test rax, rax
0x14013ec2c: je 0x14013ecb6
0x14013ec32: mov qword ptr [rbx + 8], rdi
0x14013ec36: mov rcx, qword ptr [rbp - 0x31]
0x14013ec3a: call 0x1402ec0f4   [CALL]
0x14013ec3f: lea rax, [rip + 0x7bfec2]   ; -> 0x1408feb08
0x14013ec46: mov qword ptr [rbp - 0x49], rax
0x14013ec4a: mov rcx, qword ptr [rbp - 0x41]
0x14013ec4e: add rcx, -0x10
0x14013ec52: lea rax, [rip + 0x8ccac7]   ; -> 0x140a0b720
0x14013ec59: cmp rcx, rax
0x14013ec5c: je 0x14013ec6f
0x14013ec5e: lock xadd dword ptr [rcx], esi
0x14013ec62: dec esi
0x14013ec64: cmp esi, -1
0x14013ec67: jne 0x14013ec6f
0x14013ec69: call 0x1402e5784   [CALL]
0x14013ec6e: nop 
0x14013ec6f: jmp 0x14013ec95
0x14013ec71: movsxd rdx, dword ptr [rdx + 0x30]
0x14013ec75: mov r8, qword ptr [r13 + 0x40]
0x14013ec79: lea rcx, [r15 + 8]
0x14013ec7d: mov rax, qword ptr [rcx]
0x14013ec80: cmp rax, qword ptr [rcx + 8]
0x14013ec84: je 0x14013ec8a
0x14013ec86: mov qword ptr [rcx + 8], rax
0x14013ec8a: mov r9, rdx
0x14013ec8d: mov rdx, rax
0x14013ec90: call 0x14014f2c0   [CALL]
0x14013ec95: lea r11, [rsp + 0xc0]
0x14013ec9d: mov rbx, qword ptr [r11 + 0x38]
0x14013eca1: mov rsi, qword ptr [r11 + 0x40]
0x14013eca5: mov rdi, qword ptr [r11 + 0x48]
0x14013eca9: mov rsp, r11
0x14013ecac: pop r15
0x14013ecae: pop r14
0x14013ecb0: pop r13
0x14013ecb2: pop r12
0x14013ecb4: pop rbp
0x14013ecb5: ret 
0x14013ecb6: lea rcx, [rbp + 7]
0x14013ecba: call 0x1401cac70   [CALL]
0x14013ecbf: lea rdx, [rip + 0x8c6f5a]   ; -> 0x140a05c20
0x14013ecc6: lea rcx, [rbp + 7]
0x14013ecca: call 0x1402e836c   [CALL]
0x14013eccf: int3 
0x14013ecd0: lea rcx, [rbp + 7]
0x14013ecd4: call 0x1401cac70   [CALL]
0x14013ecd9: lea rdx, [rip + 0x8c6f40]   ; -> 0x140a05c20
0x14013ece0: lea rcx, [rbp + 7]
0x14013ece4: call 0x1402e836c   [CALL]
0x14013ece9: nop 
0x14013ecea: lea rcx, [rbp + 7]
0x14013ecee: call 0x1401cac70   [CALL]
0x14013ecf3: lea rdx, [rip + 0x8c6f26]   ; -> 0x140a05c20
0x14013ecfa: lea rcx, [rbp + 7]
0x14013ecfe: call 0x1402e836c   [CALL]
0x14013ed03: int3 
0x14013ed04: int3 
0x14013ed05: int3 
0x14013ed06: int3 
0x14013ed07: int3 
0x14013ed08: int3 
0x14013ed09: int3 
0x14013ed0a: int3 
0x14013ed0b: int3 
0x14013ed0c: int3 
0x14013ed0d: int3 
0x14013ed0e: int3 
0x14013ed0f: int3 
