0x14059fce0: push rbx
0x14059fce2: push rsi
0x14059fce3: push rdi
0x14059fce4: push r13
0x14059fce6: sub rsp, 0xa8
0x14059fced: mov rax, qword ptr [rip + 0x469ecc]   ; -> 0x140a09bc0
0x14059fcf4: xor rax, rsp
0x14059fcf7: mov qword ptr [rsp + 0x90], rax
0x14059fcff: mov rbx, rcx
0x14059fd02: mov rax, r8
0x14059fd05: mov ecx, dword ptr [rcx + 0x58]
0x14059fd08: mov r13d, edx
0x14059fd0b: mov qword ptr [rsp + 0x40], rax
0x14059fd10: mov edi, 1
0x14059fd15: test ecx, ecx
0x14059fd17: je 0x14059fe40
0x14059fd1d: mov eax, edx
0x14059fd1f: mov byte ptr [rsp + 0x59], cl
0x14059fd23: shr eax, 0x18
0x14059fd26: mov byte ptr [rsp + 0x50], al
0x14059fd2a: mov eax, edx
0x14059fd2c: shr eax, 0x10
0x14059fd2f: mov byte ptr [rsp + 0x51], al
0x14059fd33: mov eax, edx
0x14059fd35: shr eax, 8
0x14059fd38: lea rdx, [rip + 0x292741]   ; " using zstream"
0x14059fd3f: mov byte ptr [rsp + 0x52], al
0x14059fd43: mov eax, ecx
0x14059fd45: shr eax, 0x18
0x14059fd48: mov byte ptr [rsp + 0x56], al
0x14059fd4c: mov eax, ecx
0x14059fd4e: shr eax, 0x10
0x14059fd51: mov byte ptr [rsp + 0x57], al
0x14059fd55: mov eax, ecx
0x14059fd57: shr eax, 8
0x14059fd5a: mov ecx, 0xa
0x14059fd5f: mov byte ptr [rsp + 0x58], al
0x14059fd63: mov byte ptr [rsp + 0x53], r13b
0x14059fd68: mov word ptr [rsp + 0x54], 0x203a
0x14059fd6f: nop 
0x14059fd70: cmp rcx, 0x3f
0x14059fd74: jae 0x14059fd89
0x14059fd76: movzx eax, byte ptr [rdx + rcx - 0xa]
0x14059fd7b: mov byte ptr [rsp + rcx + 0x50], al
0x14059fd7f: inc rcx
0x14059fd82: cmp byte ptr [rdx + rcx - 0xa], 0
0x14059fd87: jne 0x14059fd70
0x14059fd89: mov byte ptr [rsp + rcx + 0x50], 0
0x14059fd8e: xor ecx, ecx
0x14059fd90: cmp byte ptr [rsp + 0x50], 0x23
0x14059fd95: jne 0x14059fdbf
0x14059fd97: mov ecx, edi
0x14059fd99: mov rax, rdi
0x14059fd9c: nop dword ptr [rax]
0x14059fda0: cmp byte ptr [rsp + rax + 0x50], 0x20
0x14059fda5: je 0x14059fdbf
0x14059fda7: cmp byte ptr [rsp + rax + 0x51], 0x20
0x14059fdac: je 0x14059fdbd
0x14059fdae: add rax, 2
0x14059fdb2: add ecx, 2
0x14059fdb5: cmp rax, 0xf
0x14059fdb9: jl 0x14059fda0
0x14059fdbb: jmp 0x14059fdbf
0x14059fdbd: inc ecx
0x14059fdbf: mov r8, qword ptr [rbx + 8]
0x14059fdc3: lea rsi, [rsp + 0x50]
0x14059fdc8: movsxd rax, ecx
0x14059fdcb: add rsi, rax
0x14059fdce: test r8, r8
0x14059fdd1: je 0x14059fdde
0x14059fdd3: mov rdx, rsi
0x14059fdd6: mov rcx, rbx
0x14059fdd9: call r8
0x14059fddc: jmp 0x14059fe13
0x14059fdde: mov ecx, 2
0x14059fde3: call 0x1402f426c
0x14059fde8: mov rcx, rax
0x14059fdeb: lea rdx, [rip + 0x290a66]   ; "libpng warning: %s"
0x14059fdf2: mov r8, rsi
0x14059fdf5: call 0x140292650
0x14059fdfa: mov ecx, 2
0x14059fdff: call 0x1402f426c
0x14059fe04: mov rcx, rax
0x14059fe07: lea rdx, [rip + 0x290a46]   ; -> 0x140830854
0x14059fe0e: call 0x140292650
0x14059fe13: cmp dword ptr [rbx + 0x58], 0x49444154
0x14059fe1a: jne 0x14059fe34
0x14059fe1c: lea rax, [rip + 0x29264d]   ; "in use by IDAT"
0x14059fe23: mov qword ptr [rbx + 0x80], rax
0x14059fe2a: mov eax, 0xfffffffe
0x14059fe2f: jmp 0x14059ffd6
0x14059fe34: mov rax, qword ptr [rsp + 0x40]
0x14059fe39: mov dword ptr [rbx + 0x58], 0
0x14059fe40: mov esi, dword ptr [rbx + 0xcc]
0x14059fe46: mov qword ptr [rsp + 0xd8], rbp
0x14059fe4e: mov qword ptr [rsp + 0xe0], r12
0x14059fe56: mov r12d, dword ptr [rbx + 0xd0]
0x14059fe5d: mov qword ptr [rsp + 0xe8], r14
0x14059fe65: mov r14d, dword ptr [rbx + 0xc4]
0x14059fe6c: mov qword ptr [rsp + 0xa0], r15
0x14059fe74: mov r15d, dword ptr [rbx + 0xc8]
0x14059fe7b: cmp r13d, 0x49444154
0x14059fe82: jne 0x14059fea1
0x14059fe84: test byte ptr [rbx + 0x50], dil
0x14059fe88: je 0x14059fe92
0x14059fe8a: mov ebp, dword ptr [rbx + 0xd4]
0x14059fe90: jmp 0x14059fec2
0x14059fe92: xor ebp, ebp
0x14059fe94: cmp byte ptr [rbx + 0x16e], 8
0x14059fe9b: setne bpl
0x14059fe9f: jmp 0x14059fec2
0x14059fea1: mov r14d, dword ptr [rbx + 0xd8]
0x14059fea8: mov r15d, dword ptr [rbx + 0xdc]
0x14059feaf: mov esi, dword ptr [rbx + 0xe0]
0x14059feb5: mov r12d, dword ptr [rbx + 0xe4]
0x14059febc: mov ebp, dword ptr [rbx + 0xe8]
0x14059fec2: cmp rax, 0x4000
0x14059fec8: ja 0x14059feeb
0x14059feca: lea ecx, [rsi - 1]
0x14059fecd: shl edi, cl
0x14059fecf: lea rcx, [rax + 0x106]
0x14059fed6: mov eax, edi
0x14059fed8: cmp rcx, rax
0x14059fedb: ja 0x14059feeb
0x14059fedd: nop dword ptr [rax]
0x14059fee0: shr edi, 1
0x14059fee2: dec esi
0x14059fee4: mov eax, edi
0x14059fee6: cmp rcx, rax
0x14059fee9: jbe 0x14059fee0
0x14059feeb: mov eax, dword ptr [rbx + 0x50]
0x14059feee: test al, 2
0x14059fef0: je 0x14059ff85
0x14059fef6: cmp dword ptr [rbx + 0xec], r14d
0x14059fefd: jne 0x14059ff21
0x14059feff: cmp dword ptr [rbx + 0xf0], r15d
0x14059ff06: jne 0x14059ff21
0x14059ff08: cmp dword ptr [rbx + 0xf4], esi
0x14059ff0e: jne 0x14059ff21
0x14059ff10: cmp dword ptr [rbx + 0xf8], r12d
0x14059ff17: jne 0x14059ff21
0x14059ff19: cmp dword ptr [rbx + 0xfc], ebp
0x14059ff1f: je 0x14059ff85
0x14059ff21: lea rcx, [rbx + 0x60]
0x14059ff25: call 0x140450860
0x14059ff2a: test eax, eax
0x14059ff2c: je 0x14059ff7e
0x14059ff2e: mov rax, qword ptr [rbx + 8]
0x14059ff32: test rax, rax
0x14059ff35: je 0x14059ff45
0x14059ff37: lea rdx, [rip + 0x292562]   ; "deflateEnd failed (ignored)"
0x14059ff3e: mov rcx, rbx
0x14059ff41: call rax
0x14059ff43: jmp 0x14059ff7e
0x14059ff45: mov ecx, 2
0x14059ff4a: call 0x1402f426c
0x14059ff4f: mov rcx, rax
0x14059ff52: lea r8, [rip + 0x292547]   ; "deflateEnd failed (ignored)"
0x14059ff59: lea rdx, [rip + 0x2908f8]   ; "libpng warning: %s"
0x14059ff60: call 0x140292650
0x14059ff65: mov ecx, 2
0x14059ff6a: call 0x1402f426c
0x14059ff6f: mov rcx, rax
0x14059ff72: lea rdx, [rip + 0x2908db]   ; -> 0x140830854
0x14059ff79: call 0x140292650
0x14059ff7e: and dword ptr [rbx + 0x50], 0xfffffffd
0x14059ff82: mov eax, dword ptr [rbx + 0x50]
0x14059ff85: xor edx, edx
0x14059ff87: lea rcx, [rbx + 0x60]
0x14059ff8b: mov qword ptr [rcx], rdx
0x14059ff8e: mov dword ptr [rbx + 0x68], edx
0x14059ff91: mov qword ptr [rbx + 0x70], rdx
0x14059ff95: mov dword ptr [rbx + 0x78], edx
0x14059ff98: test al, 2
0x14059ff9a: je 0x14059fff3
0x14059ff9c: call 0x140451440
0x14059ffa1: mov r9d, eax
0x14059ffa4: test eax, eax
0x14059ffa6: je 0x1405a0021
0x14059ffa8: mov edx, r9d
0x14059ffab: mov rcx, rbx
0x14059ffae: call 0x1405b52c0
0x14059ffb3: mov r15, qword ptr [rsp + 0xa0]
0x14059ffbb: mov eax, r9d
0x14059ffbe: mov r14, qword ptr [rsp + 0xe8]
0x14059ffc6: mov r12, qword ptr [rsp + 0xe0]
0x14059ffce: mov rbp, qword ptr [rsp + 0xd8]
0x14059ffd6: mov rcx, qword ptr [rsp + 0x90]
0x14059ffde: xor rcx, rsp
0x14059ffe1: call 0x1402e54e0
0x14059ffe6: add rsp, 0xa8
0x14059ffed: pop r13
0x14059ffef: pop rdi
0x14059fff0: pop rsi
0x14059fff1: pop rbx
0x14059fff2: ret 
0x14059fff3: lea rax, [rip + 0x292496]   ; "1.2.3"
0x14059fffa: mov r9d, esi
0x14059fffd: mov qword ptr [rsp + 0x30], rax
0x1405a0002: mov r8d, r15d
0x1405a0005: mov dword ptr [rsp + 0x28], ebp
0x1405a0009: mov edx, r14d
0x1405a000c: mov dword ptr [rsp + 0x20], r12d
0x1405a0011: call 0x1404515f0
0x1405a0016: mov r9d, eax
0x1405a0019: test eax, eax
0x1405a001b: jne 0x14059ffa8
0x1405a001d: or dword ptr [rbx + 0x50], 2
0x1405a0021: mov dword ptr [rbx + 0x58], r13d
0x1405a0025: jmp 0x14059ffb3
0x1405a0027: int3 
0x1405a0028: int3 
0x1405a0029: int3 
0x1405a002a: int3 
0x1405a002b: int3 
0x1405a002c: int3 
0x1405a002d: int3 
0x1405a002e: int3 
0x1405a002f: int3 
