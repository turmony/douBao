import json
import time
import io
import sys
from pathlib import Path
from datetime import datetime
import keyboard
from PIL import ImageGrab, Image
import requests
import base64

class ScreenshotUploader:
    def __init__(self):
        self.config = self.load_config()
        self.bound = False
        self.openid = None
        self.code = None
        
    def load_config(self):
        """加载配置文件"""
        config_path = Path(__file__).parent / 'config.json'
        
        if not config_path.exists():
            # 创建默认配置
            default_config = {
                "cloud_base_url": "https://你的云函数地址",
                "hotkey": "f9",
                "bind_code": "",
                "image_quality": 85,
                "max_width": 1920,
                "compress_format": "JPEG",
                "debug_mode": True
            }
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(default_config, f, indent=2, ensure_ascii=False)
            print(f"已创建默认配置文件: {config_path}")
            print("请编辑 config.json 填写云函数地址")
            sys.exit(0)
        
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
            
        # 添加默认值（兼容旧配置）
        config.setdefault('image_quality', 85)
        config.setdefault('max_width', 1920)
        config.setdefault('compress_format', 'JPEG')
        config.setdefault('debug_mode', True)
        
        return config
    
    def save_config(self):
        """保存配置文件"""
        config_path = Path(__file__).parent / 'config.json'
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(self.config, f, indent=2, ensure_ascii=False)
    
    def debug_print(self, message):
        """调试信息输出"""
        if self.config.get('debug_mode', False):
            print(f"[DEBUG] {message}")
    
    def bind_device(self):
        """绑定设备"""
        code = input("请输入小程序显示的6位绑定码: ").strip()
        
        if len(code) != 6 or not code.isdigit():
            print("❌ 绑定码格式错误，必须是6位数字")
            return False
        
        print(f"正在验证绑定码 {code}...")
        self.debug_print(f"请求URL: {self.config['cloud_base_url']}/bindClient")
        
        try:
            url = f"{self.config['cloud_base_url']}/bindClient"
            
            self.debug_print(f"发送请求数据: {{'code': '{code}'}}")
            
            response = requests.post(
                url,
                json={"code": code},
                timeout=10,
                headers={'Content-Type': 'application/json'}
            )
            
            self.debug_print(f"响应状态码: {response.status_code}")
            self.debug_print(f"响应头: {dict(response.headers)}")
            self.debug_print(f"响应原始内容: {response.text[:500]}")
            
            # 检查状态码
            if response.status_code != 200:
                print(f"❌ HTTP错误: {response.status_code}")
                print(f"响应内容: {response.text}")
                return False
            
            # 解析JSON
            try:
                result = response.json()
                self.debug_print(f"解析后的JSON: {result}")
            except json.JSONDecodeError as e:
                print(f"❌ JSON解析失败: {e}")
                print(f"响应内容: {response.text}")
                return False
            
            if result.get('success'):
                self.bound = True
                self.code = code
                self.openid = result.get('openid')
                print(f"✅ 绑定成功！设备已绑定到用户")
                if self.openid:
                    self.debug_print(f"OpenID: {self.openid}")
                return True
            else:
                error = result.get('error', '未知错误')
                print(f"❌ 绑定失败: {error}")
                self.debug_print(f"完整错误响应: {result}")
                return False
                
        except requests.exceptions.Timeout:
            print("❌ 请求超时，请检查网络连接")
            self.debug_print(f"超时URL: {url}")
            return False
        except requests.exceptions.ConnectionError as e:
            print(f"❌ 连接错误: 无法连接到服务器")
            print(f"URL: {url}")
            self.debug_print(f"详细错误: {str(e)}")
            return False
        except Exception as e:
            print(f"❌ 绑定失败: {str(e)}")
            self.debug_print(f"异常类型: {type(e).__name__}")
            import traceback
            self.debug_print(f"堆栈跟踪: {traceback.format_exc()}")
            return False
    
    def take_screenshot(self):
        """截取全屏"""
        try:
            print(f"\n📸 [{datetime.now().strftime('%H:%M:%S')}] 正在截图...")
            screenshot = ImageGrab.grab()
            print(f"📐 原始尺寸: {screenshot.width}x{screenshot.height}")
            self.debug_print(f"图像模式: {screenshot.mode}")
            return screenshot
        except Exception as e:
            print(f"❌ 截图失败: {str(e)}")
            import traceback
            self.debug_print(f"堆栈跟踪: {traceback.format_exc()}")
            return None
    
    def compress_image(self, screenshot):
        """压缩图片"""
        try:
            print("🔄 正在压缩图片...")
            
            # 获取配置
            max_width = self.config.get('max_width', 1920)
            quality = self.config.get('image_quality', 85)
            img_format = self.config.get('compress_format', 'JPEG')
            
            self.debug_print(f"压缩参数: max_width={max_width}, quality={quality}, format={img_format}")
            
            # 如果图片宽度超过限制，等比例缩放
            if screenshot.width > max_width:
                ratio = max_width / screenshot.width
                new_size = (max_width, int(screenshot.height * ratio))
                screenshot = screenshot.resize(new_size, Image.LANCZOS)
                print(f"📐 压缩后尺寸: {screenshot.width}x{screenshot.height}")
            
            # 转换为字节流
            img_byte_arr = io.BytesIO()
            
            # 如果是JPEG格式，需要转换RGB模式（去除透明通道）
            if img_format.upper() == 'JPEG' and screenshot.mode in ('RGBA', 'LA', 'P'):
                self.debug_print(f"转换图像模式: {screenshot.mode} -> RGB")
                # 创建白色背景
                rgb_screenshot = Image.new('RGB', screenshot.size, (255, 255, 255))
                if screenshot.mode == 'P':
                    screenshot = screenshot.convert('RGBA')
                rgb_screenshot.paste(screenshot, mask=screenshot.split()[-1] if screenshot.mode == 'RGBA' else None)
                screenshot = rgb_screenshot
            
            # 保存压缩后的图片
            screenshot.save(img_byte_arr, format=img_format, quality=quality, optimize=True)
            img_byte_arr.seek(0)
            
            # 计算压缩后的大小
            img_bytes = img_byte_arr.getvalue()
            size_kb = len(img_bytes) / 1024
            size_mb = size_kb / 1024
            
            self.debug_print(f"压缩后字节数: {len(img_bytes)}")
            
            if size_mb > 10:
                print(f"⚠️  警告: 图片大小 {size_mb:.2f} MB，可能上传失败")
                print("💡 建议: 降低 config.json 中的 image_quality 或 max_width")
            else:
                print(f"✅ 压缩完成: {size_mb:.2f} MB ({size_kb:.0f} KB)")
            
            return img_byte_arr
            
        except Exception as e:
            print(f"❌ 压缩失败: {str(e)}")
            import traceback
            self.debug_print(f"堆栈跟踪: {traceback.format_exc()}")
            return None
    
    def upload_to_cloud_storage(self, img_byte_arr):
    # """使用临时上传链接直接上传图片到云存储"""
        try:
            print("📤 获取上传凭证...")
            
            # 确保 code 存在
            if not self.code:
                print("❌ 错误：绑定码为空")
                return None, None
            
            self.debug_print(f"当前绑定码: {self.code}")
            
            # 获取临时上传链接
            url = f"{self.config['cloud_base_url']}/getUploadUrl"
            
            request_data = {"code": self.code}
            self.debug_print(f"请求URL: {url}")
            self.debug_print(f"请求数据: {request_data}")
            
            response = requests.post(
                url,
                json=request_data,
                timeout=10,
                headers={'Content-Type': 'application/json'}
            )
            
            self.debug_print(f"响应状态码: {response.status_code}")
            self.debug_print(f"响应内容: {response.text}")
            
            if response.status_code != 200:
                print(f"❌ 获取上传凭证失败: HTTP {response.status_code}")
                print(f"响应内容: {response.text}")
                return None, None
            
            result = response.json()
            self.debug_print(f"解析后的响应: {result}")
            
            if not result.get('success'):
                error_msg = result.get('error', '未知错误')
                print(f"❌ 获取上传凭证失败: {error_msg}")
                return None, None
            
            upload_url = result.get('uploadUrl')
            file_id = result.get('fileID')
            openid = result.get('openid')
            authorization = result.get('authorization')
            token = result.get('token')
            cos_file_id = result.get('cosFileId')
            
            if not upload_url or not file_id:
                print("❌ 未获取到上传链接或文件ID")
                return None, None
            
            print(f"✅ 获取上传凭证成功")
            print(f"📤 正在直接上传到云存储...")
            self.debug_print(f"上传URL: {upload_url}")
            self.debug_print(f"FileID: {file_id}")
            
            # 准备上传
            img_bytes = img_byte_arr.getvalue()
            
            print(f"⏳ 上传中... (图片大小: {len(img_bytes)/1024:.0f} KB)")
            
            # 构建请求头
            headers = {
                'Content-Type': 'image/jpeg',
            }
            
            # 如果有 authorization，添加到请求头
            if authorization:
                headers['Authorization'] = authorization
            
            if token:
                headers['x-cos-security-token'] = token
            
            self.debug_print(f"上传请求头: {headers}")
            
            # 直接 PUT 上传到云存储
            upload_response = requests.put(
                upload_url,
                data=img_bytes,
                headers=headers,
                timeout=60
            )
            
            self.debug_print(f"上传响应状态码: {upload_response.status_code}")
            self.debug_print(f"上传响应头: {dict(upload_response.headers)}")
            
            # 200 或 204 都表示成功
            if upload_response.status_code in [200, 204]:
                print(f"✅ 上传到云存储成功")
                self.debug_print(f"最终 FileID: {file_id}")
                return file_id, openid
            else:
                print(f"❌ 上传到云存储失败: HTTP {upload_response.status_code}")
                print(f"响应内容: {upload_response.text}")
                return None, None
            
        except requests.exceptions.Timeout:
            print("❌ 上传超时")
            return None, None
        except requests.exceptions.ConnectionError as e:
            print(f"❌ 连接错误: 无法连接到服务器")
            self.debug_print(f"详细错误: {str(e)}")
            return None, None
        except Exception as e:
            print(f"❌ 上传到云存储失败: {str(e)}")
            import traceback
            self.debug_print(f"堆栈跟踪: {traceback.format_exc()}")
            return None, None
        """直接上传图片到云存储"""
        try:
            print("📤 获取上传凭证...")
            
            # 确保 code 存在
            if not self.code:
                print("❌ 错误：绑定码为空")
                return None, None
            
            self.debug_print(f"当前绑定码: {self.code}")
            
            # 获取上传路径和凭证
            url = f"{self.config['cloud_base_url']}/getUploadUrl"
            
            request_data = {"code": self.code}
            self.debug_print(f"请求URL: {url}")
            self.debug_print(f"请求数据: {request_data}")
            
            response = requests.post(
                url,
                json=request_data,
                timeout=10,
                headers={'Content-Type': 'application/json'}
            )
            
            self.debug_print(f"响应状态码: {response.status_code}")
            self.debug_print(f"响应内容: {response.text}")
            
            if response.status_code != 200:
                print(f"❌ 获取上传凭证失败: HTTP {response.status_code}")
                print(f"响应内容: {response.text}")
                return None, None
            
            result = response.json()
            self.debug_print(f"解析后的响应: {result}")
            
            if not result.get('success'):
                error_msg = result.get('error', '未知错误')
                print(f"❌ 获取上传凭证失败: {error_msg}")
                return None, None
            
            cloud_path = result.get('cloudPath')
            openid = result.get('openid')
            
            if not cloud_path:
                print("❌ 未获取到云存储路径")
                return None, None
            
            print(f"✅ 获取上传凭证成功")
            print(f"📤 正在上传到云存储...")
            self.debug_print(f"云存储路径: {cloud_path}")
            
            # 使用腾讯云提供的上传API
            img_bytes = img_byte_arr.getvalue()
            img_base64 = base64.b64encode(img_bytes).decode()
            
            self.debug_print(f"Base64长度: {len(img_base64)}")
            
            # 调用云函数上传
            upload_url = f"{self.config['cloud_base_url']}/uploadToStorage"
            self.debug_print(f"上传URL: {upload_url}")
            
            print(f"⏳ 上传中... (图片大小: {len(img_bytes)/1024:.0f} KB)")
            
            upload_response = requests.post(
                upload_url,
                json={
                    "code": self.code,
                    "cloudPath": cloud_path,
                    "fileContent": img_base64
                },
                timeout=60,
                headers={'Content-Type': 'application/json'}
            )
            
            self.debug_print(f"上传响应状态码: {upload_response.status_code}")
            self.debug_print(f"上传响应内容: {upload_response.text}")
            
            if upload_response.status_code != 200:
                print(f"❌ 上传到云存储失败: HTTP {upload_response.status_code}")
                print(f"响应内容: {upload_response.text}")
                return None, None
            
            upload_result = upload_response.json()
            
            if upload_result.get('success'):
                file_id = upload_result.get('fileID')
                print(f"✅ 上传到云存储成功")
                self.debug_print(f"FileID: {file_id}")
                return file_id, openid
            else:
                print(f"❌ 上传到云存储失败: {upload_result.get('error')}")
                return None, None
            
        except requests.exceptions.Timeout:
            print("❌ 上传超时")
            print("💡 可能原因:")
            print("   1. 网络连接不稳定")
            print("   2. 图片太大，云函数处理超时")
            print("   3. 云函数配置的超时时间不足")
            return None, None
        except requests.exceptions.ConnectionError as e:
            print(f"❌ 连接错误: 无法连接到服务器")
            print(f"URL: {url}")
            self.debug_print(f"详细错误: {str(e)}")
            return None, None
        except Exception as e:
            print(f"❌ 上传到云存储失败: {str(e)}")
            import traceback
            self.debug_print(f"堆栈跟踪: {traceback.format_exc()}")
            return None, None
    
    def upload_screenshot(self, screenshot):
        """上传截图 - 使用二进制方式"""
        if not self.bound:
            print("❌ 设备未绑定，请先完成绑定")
            return False
        
        try:
            # 压缩图片
            img_byte_arr = self.compress_image(screenshot)
            if not img_byte_arr:
                return False
            
            img_bytes = img_byte_arr.getvalue()
            size_kb = len(img_bytes) / 1024
            size_mb = size_kb / 1024
            
            # 检查大小（二进制上传限制是 6MB）
            if size_mb > 5:  # 留一些余量
                print(f"⚠️  图片过大 ({size_mb:.2f}MB)，正在进一步压缩...")
                
                # 进一步压缩
                screenshot_pil = Image.open(img_byte_arr)
                img_byte_arr = io.BytesIO()
                
                # 大幅降低质量和尺寸
                quality = 30
                max_width = 800
                
                if screenshot_pil.width > max_width:
                    ratio = max_width / screenshot_pil.width
                    new_size = (max_width, int(screenshot_pil.height * ratio))
                    screenshot_pil = screenshot_pil.resize(new_size, Image.LANCZOS)
                
                # 转换为RGB
                if screenshot_pil.mode in ('RGBA', 'LA', 'P'):
                    rgb_img = Image.new('RGB', screenshot_pil.size, (255, 255, 255))
                    if screenshot_pil.mode == 'P':
                        screenshot_pil = screenshot_pil.convert('RGBA')
                    rgb_img.paste(screenshot_pil, mask=screenshot_pil.split()[-1] if screenshot_pil.mode == 'RGBA' else None)
                    screenshot_pil = rgb_img
                
                screenshot_pil.save(img_byte_arr, format='JPEG', quality=quality, optimize=True)
                img_byte_arr.seek(0)
                
                img_bytes = img_byte_arr.getvalue()
                size_kb = len(img_bytes) / 1024
                size_mb = size_kb / 1024
                
                print(f"✅ 二次压缩完成: {size_mb:.2f} MB")
                
                if size_mb > 5:
                    print("❌ 图片仍然过大，无法上传")
                    return False
            
            print(f"📤 正在上传截图... ({size_mb:.2f} MB)")
            
            # 使用二进制上传
            url = f"{self.config['cloud_base_url']}/uploadScreenshot?code={self.code}"
            
            self.debug_print(f"上传URL: {url}")
            self.debug_print(f"图片大小: {len(img_bytes)} bytes")
            
            response = requests.post(
                url,
                data=img_bytes,
                headers={
                    'Content-Type': 'application/octet-stream'
                },
                timeout=60
            )
            
            self.debug_print(f"响应状态码: {response.status_code}")
            self.debug_print(f"响应内容: {response.text}")
            
            if response.status_code != 200:
                print(f"❌ HTTP错误: {response.status_code}")
                print(f"响应内容: {response.text}")
                return False
            
            result = response.json()
            
            if result.get('success'):
                print("✅ 上传成功！请在小程序查看分析结果")
                return True
            else:
                error = result.get('error', '未知错误')
                print(f"❌ 上传失败: {error}")
                return False
                
        except Exception as e:
            print(f"❌ 上传失败: {str(e)}")
            import traceback
            self.debug_print(f"堆栈跟踪: {traceback.format_exc()}")
            return False
        """上传截图"""
        if not self.bound:
            print("❌ 设备未绑定，请先完成绑定")
            return False
        
        try:
            # 压缩图片
            img_byte_arr = self.compress_image(screenshot)
            if not img_byte_arr:
                return False
            
            # 检查压缩后的大小
            img_bytes = img_byte_arr.getvalue()
            size_kb = len(img_bytes) / 1024
            size_mb = size_kb / 1024
            
            # base64 编码后会增大约 33%
            base64_size_mb = size_mb * 1.33
            
            if base64_size_mb > 0.8:  # 留一些余量，确保不超过 1MB
                print(f"⚠️  图片过大 ({base64_size_mb:.2f}MB)，正在进一步压缩...")
                
                # 进一步压缩
                screenshot_pil = Image.open(img_byte_arr)
                
                # 降低质量
                img_byte_arr = io.BytesIO()
                quality = 40
                max_width = 1024
                
                # 进一步缩小
                if screenshot_pil.width > max_width:
                    ratio = max_width / screenshot_pil.width
                    new_size = (max_width, int(screenshot_pil.height * ratio))
                    screenshot_pil = screenshot_pil.resize(new_size, Image.LANCZOS)
                
                # 转换为RGB
                if screenshot_pil.mode in ('RGBA', 'LA', 'P'):
                    rgb_img = Image.new('RGB', screenshot_pil.size, (255, 255, 255))
                    if screenshot_pil.mode == 'P':
                        screenshot_pil = screenshot_pil.convert('RGBA')
                    rgb_img.paste(screenshot_pil, mask=screenshot_pil.split()[-1] if screenshot_pil.mode == 'RGBA' else None)
                    screenshot_pil = rgb_img
                
                # 保存
                screenshot_pil.save(img_byte_arr, format='JPEG', quality=quality, optimize=True)
                img_byte_arr.seek(0)
                
                img_bytes = img_byte_arr.getvalue()
                size_kb = len(img_bytes) / 1024
                size_mb = size_kb / 1024
                base64_size_mb = size_mb * 1.33
                
                print(f"✅ 二次压缩完成: {size_mb:.2f} MB (base64: {base64_size_mb:.2f} MB)")
                
                if base64_size_mb > 0.9:
                    print("❌ 图片仍然过大，无法上传")
                    print("💡 建议:")
                    print("   1. 降低屏幕分辨率后再截图")
                    print("   2. 在 config.json 中设置 max_width: 800")
                    return False
            
            print("📤 正在上传截图...")
            
            # Base64编码
            img_base64 = base64.b64encode(img_bytes).decode()
            
            self.debug_print(f"Base64长度: {len(img_base64)}")
            self.debug_print(f"Base64前50字符: {img_base64[:50]}...")
            
            # 准备请求数据
            upload_data = {
                "code": self.code,
                "imageBase64": img_base64
            }
            
            # 上传到云函数
            url = f"{self.config['cloud_base_url']}/uploadScreenshot"
            self.debug_print(f"请求URL: {url}")
            
            print(f"⏳ 上传中... (图片大小: {size_kb:.0f} KB)")
            
            response = requests.post(
                url,
                json=upload_data,
                timeout=60,
                headers={'Content-Type': 'application/json'}
            )
            
            self.debug_print(f"响应状态码: {response.status_code}")
            self.debug_print(f"响应内容: {response.text[:1000]}")
            
            # 检查状态码
            if response.status_code != 200:
                print(f"❌ HTTP错误: {response.status_code}")
                print(f"响应内容: {response.text}")
                return False
            
            # 解析JSON
            try:
                result = response.json()
                self.debug_print(f"解析后的JSON: {result}")
            except json.JSONDecodeError as e:
                print(f"❌ JSON解析失败: {e}")
                print(f"响应内容: {response.text}")
                return False
            
            if result.get('success'):
                print("✅ 上传成功！请在小程序查看分析结果")
                if result.get('fileID'):
                    self.debug_print(f"文件ID: {result.get('fileID')}")
                return True
            else:
                error = result.get('error', '未知错误')
                print(f"❌ 上传失败: {error}")
                self.debug_print(f"完整错误响应: {result}")
                
                # 如果是图片过大的错误，给出建议
                if '过大' in error or 'too large' in error.lower() or 'EXCEED' in error:
                    print("\n💡 解决方案:")
                    print("   1. 在 config.json 中设置:")
                    print("      \"image_quality\": 40")
                    print("      \"max_width\": 1024")
                    print("   2. 或降低屏幕分辨率后再截图")
                
                return False
                
        except requests.exceptions.Timeout:
            print("❌ 上传超时")
            print("💡 可能原因:")
            print("   1. 网络连接不稳定")
            print("   2. 图片太大，云函数处理超时")
            return False
        except requests.exceptions.ConnectionError as e:
            print(f"❌ 连接错误: 无法连接到服务器")
            print(f"URL: {url}")
            self.debug_print(f"详细错误: {str(e)}")
            return False
        except Exception as e:
            print(f"❌ 上传失败: {str(e)}")
            self.debug_print(f"异常类型: {type(e).__name__}")
            import traceback
            self.debug_print(f"堆栈跟踪: {traceback.format_exc()}")
            return False
        """上传截图"""
        if not self.bound:
            print("❌ 设备未绑定，请先完成绑定")
            return False
        
        try:
            # 压缩图片
            img_byte_arr = self.compress_image(screenshot)
            if not img_byte_arr:
                return False
            
            # 上传到云存储
            file_id, openid = self.upload_to_cloud_storage(img_byte_arr)
            if not file_id:
                return False
            
            print("📤 正在通知服务器处理...")
            
            # 通知云函数处理
            url = f"{self.config['cloud_base_url']}/uploadScreenshot"
            self.debug_print(f"通知URL: {url}")
            
            response = requests.post(
                url,
                json={
                    "code": self.code,
                    "fileID": file_id
                },
                timeout=30,
                headers={'Content-Type': 'application/json'}
            )
            
            self.debug_print(f"通知响应状态码: {response.status_code}")
            self.debug_print(f"通知响应内容: {response.text}")
            
            if response.status_code != 200:
                print(f"❌ 通知服务器失败: HTTP {response.status_code}")
                print(f"响应内容: {response.text}")
                return False
            
            result = response.json()
            
            if result.get('success'):
                print("✅ 上传成功！请在小程序查看分析结果")
                return True
            else:
                print(f"❌ 处理失败: {result.get('error')}")
                return False
            
        except Exception as e:
            print(f"❌ 上传失败: {str(e)}")
            import traceback
            self.debug_print(f"堆栈跟踪: {traceback.format_exc()}")
            return False
    
    def on_hotkey(self):
        """热键回调"""
        screenshot = self.take_screenshot()
        if screenshot:
            self.upload_screenshot(screenshot)
    
    def run(self):
        """运行主程序"""
        print("=" * 50)
        print("  截图上传客户端 v2.0 (云存储直传版)")
        print("=" * 50)
        
        # 显示调试模式状态
        if self.config.get('debug_mode'):
            print("\n🔍 调试模式: 已启用")
            print("   (在 config.json 中设置 debug_mode: false 可关闭)")
        
        # 检查配置
        if not self.config.get('cloud_base_url') or \
           '你的' in self.config['cloud_base_url'] or \
           'your' in self.config['cloud_base_url'].lower():
            print("\n❌ 请先在 config.json 中配置云函数地址")
            print("提示: 云函数地址格式为 https://xxxx.service.tcloudbase.com")
            input("\n按回车键退出...")
            return
        
        # 显示配置信息
        print(f"\n📡 云函数地址: {self.config['cloud_base_url']}")
        
        # 显示压缩配置
        print(f"\n⚙️  压缩设置:")
        print(f"   格式: {self.config.get('compress_format', 'JPEG')}")
        print(f"   质量: {self.config.get('image_quality', 85)}")
        print(f"   最大宽度: {self.config.get('max_width', 1920)}px")
        
        # 绑定设备
        print("\n🔗 开始绑定设备...")
        while not self.bound:
            if not self.bind_device():
                retry = input("\n是否重试？(Y/n): ").strip().lower()
                if retry == 'n':
                    return
            time.sleep(1)
        
        # 注册热键
        hotkey = self.config.get('hotkey', 'f9')
        print(f"\n⌨️  已注册热键: {hotkey.upper()}")
        print(f"按 {hotkey.upper()} 键进行截图上传")
        print("按 Ctrl+C 退出程序\n")
        
        keyboard.add_hotkey(hotkey, self.on_hotkey)
        
        try:
            # 保持运行
            keyboard.wait()
        except KeyboardInterrupt:
            print("\n\n👋 程序已退出")

if __name__ == '__main__':
    uploader = ScreenshotUploader()
    uploader.run()