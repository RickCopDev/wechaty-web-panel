import superagent from 'superagent'
import { getFormatQuery } from '../lib/index.js'
import { getAibotConfig } from '../db/aiDb.js'
import { AIBOTK, TXHOST } from './config.js'
import { allConfig } from '../db/configDb.js'
import { readFile, writeFile } from 'fs/promises'
import axios from 'axios'
import { writeFileSync } from 'fs'

// 'N' 表示不使用本地配置平台，其他都表示使用
const useLocalConfig = process.env['USE_LOCAL_CONFIG'] || 'Y'
// 当使用微秘书配置平台时，需要忽略存储的请求
const ignoreEndpoints = ['/wechat/heart', '/worker/verifycode', '/worker/clearverifycode', '/wechat/qrcode']

let localConfigs = null

const service = axios.create({
  // 定义统一的请求头部
  headers: {
    'Content-Type': 'application/json',
  },
  // 配置请求超时时间
  timeout: 60000,
  // 如果用的JSONP，可以配置此参数带上cookie凭证，如果是代理和CORS不用设置
  withCredentials: false,
})
// 请求拦截
service.interceptors.request.use((config) => {
  return config
})
// 返回拦截
service.interceptors.response.use(
  (response) => {
    if (response.status === 200) {
      // 获取接口返回结果
      const res = response.data
      // code为0，直接把结果返回回去，这样前端代码就不用在获取一次data.
      if (res.code === 200) {
        if (Array.isArray(res.data)) {
          return Promise.resolve(res.data)
        } else {
          const result = [{ type: 1, content: '回调函数返回参数错误：' + JSON.stringify(res.data) }]
          return Promise.resolve(result)
        }
      } else {
        const result = [{ type: 1, content: res.msg }]
        return Promise.resolve(result)
      }
    }
    console.log(`回调接口网络错误：${response.status}`)
    const res = [{ type: 1, content: '' }]
    return Promise.resolve(res)
  },
  (err) => {
    console.log('回调接口网络错误:', err)
    const res = [{ type: 1, content: '' }]
    return Promise.resolve(res)
  }
)
/**
 * 封装get请求
 * @param {*} url 地址
 * @param {*} params 参数
 * @param {*} contentType 发送请求数据类型
 */
function get({ url, params, contentType = 'application/json', platform = 'tx', authorization = '', spider = false }) {
  return new Promise((resolve, reject) => {
    superagent
      .get(url)
      .query(params)
      .set('Content-Type', contentType)
      .set('Authorization', authorization)
      .end((err, res) => {
        if (err) {
          console.log('请求出错', err)
          reject(err)
        } else {
          if (spider) {
            // 如果是爬取内容，直接返回页面html
            resolve(res.text)
          } else {
            // 如果是非爬虫，返回格式化后的内容
            res = (res && res.text && JSON.parse(res.text)) || {}
            if (platform !== 'chuan') {
              if ((res.code !== 200 && platform === 'tx') || (res.code !== 200 && platform === 'aibot') || (res.code !== 0 && platform === 'qi') || (res.code !== 100000 && platform === 'tl')) {
                console.error(`接口${url}请求失败`, res.msg || res.text)
              }
            }
            const endpoint = url.replace(AIBOTK, '')
            // if read from the platfrom, store the server values.
            if (res && useLocalConfig === 'N' && !ignoreEndpoints.includes(endpoint)) {
              try {
                writeFileSync(`${endpoint.replace(/\//g, '_')}.json`, JSON.stringify(res))
                console.log(`platform config for ${endpoint} has been stored.`)
              } catch (error) {
                console.log(`An error ${error} has occurred when writing platform config for ${endpoint}`)
              }
            }
            resolve(res)
          }
        }
      })
  })
}
/**
 * 封装post请求
 * @param {*} url 地址
 * @param {*} params 参数
 * @param {*} contentType 发送请求数据类型
 * @param authorization
 */
function post({ url, params, contentType = 'application/json', authorization = '', platform = 'tx', spider = false, skipCheck = false }) {
  return new Promise((resolve, reject) => {
    superagent
      .post(url)
      .send(params)
      .set('Content-Type', contentType)
      .set('Authorization', authorization)
      .end((err, res) => {
        if (err) {
          console.log('请求出错', err)
          reject(err)
        } else {
          if (spider) {
            // 如果是爬取内容，直接返回页面html
            resolve(res.text)
          } else {
            // 如果是非爬虫，返回格式化后的内容
            res = (res && res.text && JSON.parse(res.text)) || {}
            if (platform !== 'chuan') {
              if ((res.code !== 200 && platform === 'tx') || (res.code !== 200 && platform === 'aibot') || (res.code !== 100000 && platform === 'tl')) {
                console.error(`接口请求失败${url}`, res.msg || res.text || res.error)
              }
            }
            resolve(res)
          }
        }
      })
  })
}
function req(option) {
  if (!option) return
  if (option.method === 'POST') {
    return post(option)
  } else {
    return get(option)
  }
}
async function txReq(option) {
  const config = await allConfig()
  if (!option) return
  const params = {
    key: config.txApiKey,
    ...option.params,
  }
  if (option.method === 'POST') {
    return post({ url: TXHOST + option.url, params, contentType: option.contentType })
  } else {
    return get({ url: TXHOST + option.url, params, contentType: option.contentType })
  }
}
async function aiBotReq(option) {
  const env = await getAibotConfig()
  const { apiKey, apiSecret } = env
  if (!option) return
  if (!apiKey || !apiSecret) {
    console.warn('未设置apikey或apiSecret，请登录https://wechat.aibotk.com 获取后重试')
    return
  }
  let params = getFormatQuery(apiKey, apiSecret, option.params)
  if (option.method === 'POST') {
    return post({ url: AIBOTK + option.url, params, contentType: 'application/json;charset=utf-8', platform: option.platform || 'aibot' })
  } else {
    if (useLocalConfig !== 'N') {
      if (!localConfigs) {
        try {
          localConfigs = JSON.parse(await readFile('localConfigs.json'))
        } catch (error) {
          console.log('读取本地配置文件失败：', error)
        }
      }

      if (localConfigs && localConfigs[option.url]) {
        console.log(`从本地配置源找到 ${option.url}`)
        // 特殊处理 /wechat/config
        if (option.url === '/wechat/config') {
          return {
            data: {
              config: JSON.stringify(localConfigs[option.url].config),
            },
          }
        }
        return { data: localConfigs[option.url] }
      }

      if (option.url !== '/wechat/heart') {
        console.log(`本地配置源未找到节点 ${option.url}, 将从配置平台拉取`)
      }
    }
    return get({ url: AIBOTK + option.url, params, contentType: option.contentType, platform: option.platform || 'aibot' })
  }
}
async function callbackAibotApi(url, data, timeout = 60) {
  const env = await getAibotConfig()
  const { apiKey, apiSecret } = env
  if (!apiKey || !apiSecret) {
    console.warn('未设置apikey或apiSecret，请登录https://wechat.aibotk.com 获取后重试')
    return []
  }
  data = getFormatQuery(apiKey, apiSecret, data)
  let res = await service.post(url, data, { timeout: timeout * 1000 })
  return res
}
export { req }
export { txReq }
export { aiBotReq }
export { service }
export { callbackAibotApi }
export default {
  req,
  txReq,
  aiBotReq,
  service,
  callbackAibotApi,
}
